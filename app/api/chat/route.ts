import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase";
import { createConversation, insertMessage } from "@/lib/db";
import { detectIntent } from "@/lib/intent";
import { getMatchup, getCoaches, searchPlayers, MatchupGame } from "@/lib/cfbd";
import { makeCacheKey, withCache } from "@/lib/cfbd-cache";
import { streamFormattedReply } from "@/lib/openai";

interface ChatRequest {
  message: string;
  conversationId?: string;
}

interface ErrorResponse {
  error: string;
}

// A handler returns either verified facts (streamed through OpenAI) or a
// ready-made fallback string (returned as-is — no LLM call, no cost).
type FactResult =
  | { found: true; data: unknown }
  | { found: false; message: string };

// ---------------------------------------------------------------------------
// Intent handlers — return structured facts, not prose
// ---------------------------------------------------------------------------

const MATCHUP_TTL_HOURS = 24;
const COACHES_TTL_HOURS = 24;
const PLAYER_TTL_HOURS = 24;

async function handleLastRivalWin(
  db: SupabaseClient,
  team: string | undefined,
  rival: string | undefined
): Promise<FactResult> {
  if (!team || !rival) {
    return {
      found: false,
      message:
        "I couldn't identify two teams in your question. " +
        'Try asking something like "When was the last time Michigan beat Ohio State?"',
    };
  }

  const key = makeCacheKey("/games/matchup", { team1: team, team2: rival });
  const matchup = await withCache(db, key, MATCHUP_TTL_HOURS, () =>
    getMatchup(team, rival)
  );

  const wins = matchup.games.filter(
    (g): g is MatchupGame & { home_score: number; away_score: number } =>
      g.home_score !== null &&
      g.away_score !== null &&
      g.winner?.toLowerCase() === team.toLowerCase()
  );

  if (wins.length === 0) {
    return {
      found: false,
      message: `${team} has no recorded wins against ${rival} in the available data.`,
    };
  }

  const last = wins[wins.length - 1];
  const isHome = last.home_team.toLowerCase() === team.toLowerCase();
  const teamScore = isHome ? last.home_score : last.away_score;
  const rivalScore = isHome ? last.away_score : last.home_score;

  return {
    found: true,
    data: {
      intent: "last_rival_win",
      team,
      rival,
      last_win: {
        season: last.season,
        week: last.week,
        date: last.date,
        team_score: teamScore,
        rival_score: rivalScore,
        location: last.neutral_site
          ? `neutral site (${last.venue ?? "unknown"})`
          : isHome
          ? "home"
          : "away",
      },
    },
  };
}

async function handleCoachWinPct(
  db: SupabaseClient,
  coachName: string | undefined
): Promise<FactResult> {
  if (!coachName) {
    return {
      found: false,
      message:
        "I couldn't identify a coach name in your question. " +
        'Try asking something like "What is Kirby Smart\'s winning percentage?"',
    };
  }

  const parts = coachName.trim().split(/\s+/);
  const params: { firstName?: string; lastName: string } =
    parts.length >= 2
      ? { firstName: parts[0], lastName: parts.slice(1).join(" ") }
      : { lastName: parts[0] };

  const key = makeCacheKey("/coaches", params as Record<string, string>);
  const coaches = await withCache(db, key, COACHES_TTL_HOURS, () =>
    getCoaches(params)
  );

  if (coaches.length === 0) {
    return {
      found: false,
      message: `I couldn't find a coach named "${coachName}" in the CFBD database.`,
    };
  }

  if (coaches.length > 1) {
    const names = coaches
      .map((c) => `${c.first_name} ${c.last_name}`)
      .join(", ");
    return {
      found: false,
      message:
        `I found multiple coaches matching "${coachName}": ${names}. ` +
        `Can you be more specific (e.g. include the first name)?`,
    };
  }

  const coach = coaches[0];

  if (coach.seasons.length === 0) {
    return {
      found: false,
      message: `${coach.first_name} ${coach.last_name} has no recorded seasons in the CFBD database.`,
    };
  }

  const totals = coach.seasons.reduce(
    (acc, s) => ({
      games: acc.games + s.games,
      wins: acc.wins + s.wins,
      losses: acc.losses + s.losses,
      ties: acc.ties + s.ties,
    }),
    { games: 0, wins: 0, losses: 0, ties: 0 }
  );

  if (totals.games === 0) {
    return {
      found: false,
      message: `${coach.first_name} ${coach.last_name} has no recorded games in the CFBD database.`,
    };
  }

  return {
    found: true,
    data: {
      intent: "coach_win_pct",
      coach: `${coach.first_name} ${coach.last_name}`,
      wins: totals.wins,
      losses: totals.losses,
      ties: totals.ties,
      total_games: totals.games,
      win_percentage: parseFloat(
        ((totals.wins / totals.games) * 100).toFixed(1)
      ),
      schools: Array.from(new Set(coach.seasons.map((s) => s.school))),
      years:
        coach.seasons[0].year === coach.seasons[coach.seasons.length - 1].year
          ? `${coach.seasons[0].year}`
          : `${coach.seasons[0].year}–${coach.seasons[coach.seasons.length - 1].year}`,
    },
  };
}

async function handlePlayerOrigin(
  db: SupabaseClient,
  playerName: string | undefined
): Promise<FactResult> {
  if (!playerName) {
    return {
      found: false,
      message:
        "I couldn't identify a player name in your question. " +
        'Try asking something like "Where is Bryce Young from?"',
    };
  }

  const key = makeCacheKey("/player/search", { searchTerm: playerName });
  const results = await withCache(db, key, PLAYER_TTL_HOURS, () =>
    searchPlayers(playerName)
  );

  if (results.length === 0) {
    return {
      found: false,
      message: `I couldn't find a player named "${playerName}" in the CFBD database.`,
    };
  }

  const withHometown = results.filter((p) => p.hometown);

  if (withHometown.length === 0) {
    const sample = results
      .slice(0, 3)
      .map((p) => `${p.name} (${p.team})`)
      .join(", ");
    return {
      found: false,
      message:
        results.length === 1
          ? `I found ${results[0].name} (${results[0].team}) but CFBD has no hometown data on record for them.`
          : `I found ${results.length} players matching "${playerName}" but none have hometown data on record: ${sample}.`,
    };
  }

  if (withHometown.length > 1) {
    const names = withHometown
      .slice(0, 5)
      .map((p) => `${p.name} (${p.team}, from ${p.hometown})`)
      .join("; ");
    return {
      found: false,
      message:
        `I found multiple players matching "${playerName}": ${names}. ` +
        `Can you be more specific?`,
    };
  }

  const p = withHometown[0];
  return {
    found: true,
    data: {
      intent: "player_origin",
      player: p.name,
      team: p.team,
      position: p.position ?? null,
      hometown: p.hometown,
    },
  };
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Streams a single static string as a one-chunk response. */
function streamStatic(text: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

/**
 * Streams the OpenAI-formatted reply token by token.
 * Calls `onComplete` with the full accumulated text once streaming ends
 * so callers can persist it.
 */
function streamOpenAI(
  question: string,
  data: unknown,
  onComplete: (text: string) => Promise<void>
): Response {
  return new Response(
    new ReadableStream({
      async start(controller) {
        let full = "";
        try {
          for await (const token of streamFormattedReply(question, data)) {
            full += token;
            controller.enqueue(encoder.encode(token));
          }
          await onComplete(full);
        } catch (err) {
          console.error("[stream] OpenAI error:", err);
          // If nothing was sent yet, surface a brief error token.
          if (!full) {
            controller.enqueue(
              encoder.encode("Sorry, I couldn't generate a response.")
            );
          }
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

// ---------------------------------------------------------------------------
// Route
//
// Rate-limiting strategy (not implemented here — choose based on deployment):
//   • Vercel / edge: use @upstash/ratelimit with a Redis backend — it adds
//     ~1 ms overhead and handles distributed environments correctly.
//   • Self-hosted: an in-process Map<ip, { count, resetAt }> works for a
//     single instance but won't survive restarts or scale across replicas.
//   • Recommended limits: 20 requests/minute per IP, 5 concurrent streams.
//   • Reject with 429 + Retry-After header before any DB or CFBD work is done.
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest
): Promise<Response | NextResponse<ErrorResponse>> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).message !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing required field: message (string)." },
      { status: 422 }
    );
  }

  const { message, conversationId } = body as ChatRequest;

  const trimmed = message.trim();
  if (!trimmed) {
    return NextResponse.json(
      { error: "message must not be empty." },
      { status: 422 }
    );
  }

  let db: ReturnType<typeof createServerClient>;
  let resolvedConversationId: string;

  try {
    db = createServerClient();
    resolvedConversationId =
      conversationId ?? (await createConversation(db)).id;
    await insertMessage(db, resolvedConversationId, "user", trimmed);
  } catch (err) {
    console.error("[chat] setup error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }

  const { intent, entities } = detectIntent(trimmed);

  let result: FactResult | null = null;

  try {
    if (intent === "LAST_RIVAL_WIN") {
      result = await handleLastRivalWin(db, entities.team, entities.rival);
    } else if (intent === "COACH_WIN_PCT") {
      result = await handleCoachWinPct(db, entities.coach);
    } else if (intent === "PLAYER_ORIGIN") {
      result = await handlePlayerOrigin(db, entities.player);
    }
  } catch (err) {
    console.error(`[chat] handler error (intent=${intent}):`, err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }

  // UNKNOWN intent — no LLM call.
  if (result === null) {
    const fallback =
      "I'm not sure how to answer that yet. Here are some things I can help with:\n" +
      '• "When was the last time Michigan beat Ohio State?"\n' +
      '• "What is Kirby Smart\'s winning percentage?"\n' +
      '• "Where is Bryce Young from?"';
    await insertMessage(db, resolvedConversationId, "assistant", fallback).catch(
      console.error
    );
    return streamStatic(fallback);
  }

  // Ambiguous / not-found — return prepared message as-is.
  if (!result.found) {
    await insertMessage(
      db,
      resolvedConversationId,
      "assistant",
      result.message
    ).catch(console.error);
    return streamStatic(result.message);
  }

  // Verified facts — stream through OpenAI and persist when done.
  return streamOpenAI(trimmed, result.data, async (text) => {
    await insertMessage(db, resolvedConversationId, "assistant", text);
  });
}
