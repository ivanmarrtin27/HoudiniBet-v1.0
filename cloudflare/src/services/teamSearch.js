/**
 * Team typeahead helpers: alias expansion, allowlist-friendly ranking, club dedupe.
 * DB often stores short feed names ("Man City"); users type full names ("Manchester City").
 */

function normalizeTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short / long forms that should hit the same club row(s). */
const SEARCH_ALIASES = new Map([
  ['man city', 'manchester city'],
  ['manchester city', 'manchester city'],
  ['man utd', 'manchester united'],
  ['man united', 'manchester united'],
  ['manchester utd', 'manchester united'],
  ['manchester united', 'manchester united'],
  ['spurs', 'tottenham hotspur'],
  ['tottenham', 'tottenham hotspur'],
  ['tottenham hotspur', 'tottenham hotspur'],
  ['wolves', 'wolverhampton wanderers'],
  ['wolverhampton', 'wolverhampton wanderers'],
  ['wolverhampton wanderers', 'wolverhampton wanderers'],
  ['psg', 'paris saint germain'],
  ['paris sg', 'paris saint germain'],
  ['paris saint germain', 'paris saint germain'],
  ['bayern', 'bayern munchen'],
  ['bayern munich', 'bayern munchen'],
  ['bayern munchen', 'bayern munchen'],
  ['inter', 'inter'],
  ['internazionale', 'inter'],
  ['atletico', 'atletico madrid'],
  ['atletico madrid', 'atletico madrid'],
  ['athletic', 'athletic club'],
  ['athletic club', 'athletic club'],
  ['athletic bilbao', 'athletic club'],
  ['leverkusen', 'bayer leverkusen'],
  ['bayer leverkusen', 'bayer leverkusen'],
  ['bayer 04 leverkusen', 'bayer leverkusen'],
  ['elche', 'elche'],
  ['elche cf', 'elche'],
]);

/**
 * All name strings worth matching in SQL for a user query.
 * @param {string} q
 * @returns {string[]}
 */
export function searchNameVariants(q) {
  const raw = String(q || '').trim();
  if (!raw) return [];
  const norm = normalizeTeamName(raw);
  const canon = SEARCH_ALIASES.get(norm) || norm;
  const out = new Set([raw, norm, canon]);
  for (const [alias, target] of SEARCH_ALIASES) {
    if (target === canon) out.add(alias);
  }
  return [...out].filter(Boolean);
}

/** @deprecated use searchNameVariants */
export const teamSearchVariants = searchNameVariants;

/** Prefer domestic top leagues over cups / friendlies when the same club has multiple rows. */
export function leagueSearchPriority(leagueName) {
  const n = String(leagueName || '');
  if (/^(La Liga|Premier League|Serie A|Bundesliga|Ligue 1|Segunda Divisi[oó]n|LaLiga ?2)$/i.test(n)) {
    return 0;
  }
  if (/Champions League/i.test(n)) return 1;
  if (/Europa League/i.test(n)) return 2;
  if (/Nations League/i.test(n)) return 3;
  if (/Friendlies/i.test(n)) return 4;
  return 5;
}

function clubDedupeKey(row) {
  const logo = String(row.logo_url || '');
  const af = logo.match(/\/(?:football\/)?teams\/(\d+)\./i);
  if (af) return `af:${af[1]}`;
  const fotmob = logo.match(/fotmob\.com\/.*\/(?:teamlogo|team)\/(\d+)\./i);
  if (fotmob) return `fm:${fotmob[1]}`;
  const flag = logo.match(/flagcdn\.com\/(?:\w+\/)?([a-z]{2})\.png/i);
  if (flag) return `flag:${flag[1].toLowerCase()}`;
  const api = Number(row.api_id);
  // FixtureDownload ids encode league; strip league slice when present.
  if (Number.isFinite(api) && api >= 800000000) {
    return `hash:${api % 100000}`;
  }
  return `name:${normalizeTeamName(row.name)}`;
}

/**
 * Score how well a DB team name matches the user query (higher = better).
 * @param {string} q
 * @param {string} teamName
 */
function wordsOf(s) {
  return String(s || '')
    .split(' ')
    .filter((w) => w.length > 1);
}

function tokenMatches(queryWord, nameWord) {
  if (queryWord === nameWord) return true;
  if (nameWord.startsWith(queryWord)) return true; // user typed a prefix of the DB word
  // User typed a longer form of a short DB token (manchester → man).
  if (queryWord.length >= 4 && nameWord.length >= 3 && queryWord.startsWith(nameWord)) return true;
  return false;
}

/** True when every query token matches a name word (no mid-word "man"→Germany). */
function tokensCoverName(queryNorm, nameNorm) {
  const qw = wordsOf(queryNorm);
  const nw = wordsOf(nameNorm);
  if (!qw.length || !nw.length) return false;
  return qw.every((w) => nw.some((n) => tokenMatches(w, n)));
}

export function teamSearchScore(q, teamName) {
  const variants = searchNameVariants(q).map(normalizeTeamName);
  const name = normalizeTeamName(teamName);
  if (!name || !variants.length) return 0;
  let best = 0;
  for (const v of variants) {
    if (!v) continue;
    if (name === v) best = Math.max(best, 100);
    else if (name.startsWith(v) || (v.length >= 4 && v.startsWith(name))) best = Math.max(best, 92);
    else if (tokensCoverName(v, name)) {
      best = Math.max(best, v.includes(' ') || name.includes(' ') ? 88 : 80);
    }
  }
  return best;
}

/**
 * Keep one row per club; prefer domestic league + higher score.
 * @template {{ name?: string, logo_url?: string, league_name?: string, api_id?: number }} T
 * @param {T[]} rows
 * @param {string} q
 * @returns {T[]}
 */
export function rankTeamSearchRows(rows, q) {
  const scored = (rows || [])
    .map((row) => ({
      row,
      score: teamSearchScore(q, row.name),
      leaguePri: leagueSearchPriority(row.league_name),
    }))
    .filter((x) => x.score >= 75)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.leaguePri - b.leaguePri ||
        String(a.row.name).localeCompare(String(b.row.name))
    );

  const seen = new Set();
  const out = [];
  for (const item of scored) {
    const key = clubDedupeKey(item.row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.row);
  }
  return out;
}

/** @deprecated use rankTeamSearchRows */
export function finalizeTeamSearchHits(rows, q, limit = 15) {
  return rankTeamSearchRows(rows, q).slice(0, limit);
}

/**
 * SQLite LIKE patterns for a variant (word-prefix for single tokens → avoids "man" → Germany).
 * Keeps accented + folded forms; long ASCII tokens also get vowel `_` so "almeria" hits "Almería".
 * @param {string} variant
 * @returns {string[]}
 */
export function sqlLikePatternsForVariant(variant) {
  const rawLower = String(variant || '').trim().toLowerCase();
  const v = normalizeTeamName(variant);
  if (!v) return [];

  const tokens = new Set([v]);
  if (rawLower) tokens.add(rawLower);
  // Accent-insensitive ASCII → "Almería"/"Leganés" (skip short tokens: m_n% → Munich).
  if (!v.includes(' ') && v.length >= 5) {
    const soft = v.replace(/[aeiou]/g, '_');
    if (soft !== v) tokens.add(soft);
  }

  const out = new Set();
  for (const token of tokens) {
    if (token.includes(' ')) out.add(`%${token}%`);
    else {
      out.add(`${token}%`);
      out.add(`% ${token}%`);
    }
  }
  return [...out];
}
