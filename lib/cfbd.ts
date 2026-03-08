const BASE_URL = "https://api.collegefootballdata.com";
const TIMEOUT_MS = 10_000;

function apiKey(): string {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("Missing environment variable: CFBD_API_KEY");
  return key;
}

/** Generic GET helper. Throws on non-2xx or timeout. */
async function cfbdGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  let res: globalThis.Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Distinguish timeout from other network errors for clearer logging.
    const isTimeout =
      err instanceof Error && err.name === "TimeoutError";
    const label = isTimeout ? "timeout" : "network error";
    console.error(`[cfbd] ${label} on ${path}:`, err);
    throw new Error(
      isTimeout
        ? `CFBD request timed out after ${TIMEOUT_MS / 1000}s (${path})`
        : `CFBD network error on ${path}: ${(err as Error).message}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[cfbd] HTTP ${res.status} on ${path}: ${body.slice(0, 200)}`);
    throw new Error(`CFBD ${res.status} ${res.statusText} on ${path}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Game {
  id: number;
  season: number;
  week: number;
  season_type: string;
  start_date: string;
  home_team: string;
  home_points: number | null;
  away_team: string;
  away_points: number | null;
  venue: string | null;
}

export interface Coach {
  first_name: string;
  last_name: string;
  hire_date: string | null;
  seasons: CoachSeason[];
}

export interface CoachSeason {
  school: string;
  year: number;
  games: number;
  wins: number;
  losses: number;
  ties: number;
}

export interface Player {
  id: number;
  first_name: string;
  last_name: string;
  position: string | null;
  team: string;
  year: number | null;
  jersey: number | null;
  height: number | null;
  weight: number | null;
  home_city: string | null;
  home_state: string | null;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export interface GetGamesParams {
  year: number;
  week?: number;
  team?: string;
  home?: string;
  away?: string;
  conference?: string;
  seasonType?: "regular" | "postseason" | "both";
}

export function getGames(params: GetGamesParams): Promise<Game[]> {
  const { seasonType, ...rest } = params;
  return cfbdGet<Game[]>("/games", {
    ...rest,
    seasonType,
  });
}

export interface GetCoachesParams {
  firstName?: string;
  lastName?: string;
  team?: string;
  year?: number;
  minYear?: number;
  maxYear?: number;
}

export function getCoaches(params?: GetCoachesParams): Promise<Coach[]> {
  return cfbdGet<Coach[]>("/coaches", params as Record<string, string | number | undefined>);
}

export function getRoster(team: string, year: number): Promise<Player[]> {
  return cfbdGet<Player[]>("/roster", { team, year });
}

export interface PlayerSearchResult {
  id: number;
  team: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  weight: number | null;
  height: number | null;
  jersey: number | null;
  position: string | null;
  hometown: string | null;
}

export function searchPlayers(searchTerm: string): Promise<PlayerSearchResult[]> {
  return cfbdGet<PlayerSearchResult[]>("/player/search", { searchTerm });
}

export interface MatchupGame {
  season: number;
  week: number;
  season_type: string;
  date: string;
  neutral_site: boolean;
  venue: string | null;
  home_team: string;
  home_score: number | null;
  away_team: string;
  away_score: number | null;
  winner: string | null;
}

export interface Matchup {
  team1: string;
  team2: string;
  startYear: number | null;
  endYear: number | null;
  team1Wins: number;
  team2Wins: number;
  ties: number;
  games: MatchupGame[];
}

export function getMatchup(
  team1: string,
  team2: string,
  minYear?: number,
  maxYear?: number
): Promise<Matchup> {
  return cfbdGet<Matchup>("/games/matchup", { team1, team2, minYear, maxYear });
}
