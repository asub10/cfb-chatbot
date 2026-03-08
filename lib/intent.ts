export type Intent =
  | "LAST_RIVAL_WIN"
  | "COACH_WIN_PCT"
  | "PLAYER_ORIGIN"
  | "UNKNOWN";

export interface DetectedIntent {
  intent: Intent;
  entities: Partial<{
    team: string;
    rival: string;
    coach: string;
    player: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

// Matches patterns like:
//   "last time michigan beat ohio state"
//   "did alabama ever beat auburn"
//   "when did clemson last defeat south carolina"
const RIVAL_WIN_RE =
  /\b(?:last time|last|when did|did|ever)\b.+\b(beat|defeat|win against|won against)\b/;

// Matches patterns like:
//   "kirby smart's winning percentage"
//   "what is saban's win percentage"
//   "nick saban win pct"
//   "how many games has dabo swinney won"
const COACH_WIN_RE =
  /\b(?:win(?:ning)?[\s-](?:percentage|pct|rate)|win[s]?\b.+\bcoach|coach.+\bwin[s]?\b|how many games has)\b/;

// Matches patterns like:
//   "where is cj stroud from"
//   "where does bryce young come from"
//   "what city/state is [player] from"
const PLAYER_ORIGIN_RE =
  /\bwhere\b.+\b(?:is|does|did)\b.+\b(?:from|come from|hometown|home state)\b/;

// ---------------------------------------------------------------------------
// Team/rival extraction — best-effort, covers common rival pairs
// ---------------------------------------------------------------------------

// Maps a team alias to a canonical name.
const TEAM_ALIASES: Record<string, string> = {
  "ohio state": "Ohio State",
  "the buckeyes": "Ohio State",
  buckeyes: "Ohio State",
  michigan: "Michigan",
  wolverines: "Michigan",
  alabama: "Alabama",
  bama: "Alabama",
  "the tide": "Alabama",
  auburn: "Auburn",
  tigers: "Auburn",
  clemson: "Clemson",
  georgia: "Georgia",
  bulldogs: "Georgia",
  "notre dame": "Notre Dame",
  lsu: "LSU",
  "texas a&m": "Texas A&M",
  oklahoma: "Oklahoma",
  sooners: "Oklahoma",
  texas: "Texas",
  longhorns: "Texas",
  florida: "Florida",
  gators: "Florida",
  "florida state": "Florida State",
  seminoles: "Florida State",
  "penn state": "Penn State",
  "michigan state": "Michigan State",
  "ohio st": "Ohio State",
};

function extractTeams(text: string): { team?: string; rival?: string } {
  const lower = normalize(text);

  // Sort descending by length so longer aliases match before substrings.
  const aliases = Object.keys(TEAM_ALIASES).sort((a, b) => b.length - a.length);

  // Map canonical name -> earliest position in text.
  const positions = new Map<string, number>();
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx === -1) continue;
    const canonical = TEAM_ALIASES[alias];
    if (!positions.has(canonical) || idx < positions.get(canonical)!) {
      positions.set(canonical, idx);
    }
  }

  // Return teams in the order they appear in the sentence.
  const found = Array.from(positions.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);

  return { team: found[0], rival: found[1] };
}

// ---------------------------------------------------------------------------
// Coach name extraction — simple first-last name scan before known keywords
// ---------------------------------------------------------------------------

const COACH_KEYWORDS = [
  "winning percentage",
  "win percentage",
  "win pct",
  "win rate",
  "winning pct",
  "how many games has",
  "games has",
];

function extractCoach(text: string): string | undefined {
  const lower = normalize(text);

  for (const kw of COACH_KEYWORDS) {
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;

    // Grab everything before the keyword and take the last 2–3 words as the name.
    const before = lower.slice(0, idx).trim();
    const words = before.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Strip leading stop words (what, is, what's, who, how, etc.)
    const stops = new Set(["what", "is", "what's", "who", "how", "tell", "me", "about"]);
    while (words.length > 0 && stops.has(words[0])) words.shift();

    if (words.length >= 1) {
      // Capitalize each word and strip any trailing possessive ('s).
      return words
        .slice(-3) // at most last 3 words
        .map((w) => w.replace(/'s$/, ""))
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }

  // Handle possessive: "kirby smart's" -> "Kirby Smart"
  const possessive = lower.match(/([a-z]+(?:\s[a-z]+)?)'s\s+winning/);
  if (possessive) {
    return possessive[1]
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Player name extraction — heuristic: grab noun phrase before "from"/"come from"
// ---------------------------------------------------------------------------

function extractPlayer(text: string): string | undefined {
  const lower = normalize(text);

  // "where is [name] from" / "where does [name] come from"
  const m = lower.match(/where\s+(?:is|does|did)\s+(.+?)\s+(?:come\s+from|from|hometown)/);
  if (!m) return undefined;

  const candidate = m[1].trim();
  const stops = new Set(["the", "a", "an"]);
  const words = candidate.split(/\s+/).filter((w) => !stops.has(w));
  if (words.length === 0) return undefined;

  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectIntent(message: string): DetectedIntent {
  const lower = normalize(message);

  if (RIVAL_WIN_RE.test(lower)) {
    return { intent: "LAST_RIVAL_WIN", entities: extractTeams(lower) };
  }

  if (COACH_WIN_RE.test(lower)) {
    const coach = extractCoach(lower);
    return { intent: "COACH_WIN_PCT", entities: { coach } };
  }

  if (PLAYER_ORIGIN_RE.test(lower)) {
    const player = extractPlayer(lower);
    return { intent: "PLAYER_ORIGIN", entities: { player } };
  }

  return { intent: "UNKNOWN", entities: {} };
}
