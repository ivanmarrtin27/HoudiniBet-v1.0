import * as store from '../db.js';
import { predictMany } from './predictionService.js';
import { fitTipCalibration } from './calibration.js';
import { maintainTeamRatings } from './ratingsService.js';
import {
  fetchAllWindowFixtures,
  fetchTodayFixtures,
  teamApiId,
  WINDOW_DAYS,
  HISTORY_DAYS,
} from './fixtureDownload.js';
import { fetchInternationalFixtures, fetchFotmobLiveSnapshot } from './fotmobInternationals.js';
import {
  fotmobMatchIdFromApiId,
  fetchFotmobMatchDetails,
  normalizeAfEvents,
  normalizeFotmobEvents,
  normalizeFotmobStats,
} from './matchEvents.js';
import { fetchSegundaFixtures } from './fotmobDomestic.js';
import { clubLogoUrl, flagLogoForTeamName, resolveTeamLogoUrl } from './teamLogos.js';

/** API-Football league ids for national-team competitions (not club leagues). */
const INTERNATIONAL_LEAGUE_IDS = [
  10, // Friendlies (selecciones)
  5, // UEFA Nations League
];

const API_FOOTBALL_MIN_INTERVAL_MS = 6200; // free tier: 10 calls/minute

function createApiFootballLimiter(minIntervalMs = API_FOOTBALL_MIN_INTERVAL_MS) {
  let lastRequestAt = 0;
  let queue = Promise.resolve();
  return () => {
    const request = queue.then(async () => {
      const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastRequestAt = Date.now();
    });
    queue = request.catch(() => {});
    return request;
  };
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function getLeagueIds(env) {
  return (env.LEAGUE_IDS || '140,141,39,135,78,61,5,2,3')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter(Boolean);
}

function dateOffsets(fromOffset, toOffset) {
  const dates = [];
  for (let i = fromOffset; i <= toOffset; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

/** Recompute the lowest-confidence duplicate tips until labels are ≤40%/day. */
function dailyDiversityRebalanceIds(rows, limit = 40) {
  const byDay = new Map();
  for (const row of rows || []) {
    const day = String(row.match_day || '').slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(row);
  }

  const ids = [];
  for (const day of [...byDay.keys()].sort()) {
    const dayRows = byDay.get(day) || [];
    const cap = Math.max(1, Math.floor(dayRows.length * 0.4));
    const counts = new Map();
    for (const row of dayRows) {
      if (!row.suggested_bet) continue;
      const label = String(row.suggested_bet);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    const excess = new Map(
      [...counts.entries()].filter(([, count]) => count > cap).map(([label, count]) => [label, count - cap])
    );
    if (!excess.size) continue;

    const lowestConfidenceFirst = dayRows
      .filter((row) => excess.get(String(row.suggested_bet || '')) > 0)
      .slice()
      .sort(
        (a, b) =>
          (Number(a.confidence_score) || 0) - (Number(b.confidence_score) || 0) ||
          Number(a.id) - Number(b.id)
      );
    for (const row of lowestConfidenceFirst) {
      if (ids.length >= limit) return ids;
      const label = String(row.suggested_bet);
      const remaining = excess.get(label) || 0;
      if (!remaining) continue;
      ids.push(row.id);
      excess.set(label, remaining - 1);
    }
  }
  return ids;
}

function isInternationalFixture(item) {
  const name = String(item.league?.name || '');
  const country = String(item.league?.country || '');
  const id = Number(item.league?.id);
  if (/Friendlies Clubs|Club Friendlies/i.test(name)) return false;
  if (INTERNATIONAL_LEAGUE_IDS.includes(id)) return true;
  if (country === 'World' && /^Friendlies$/i.test(name)) return true;
  if (country === 'World' && /^UEFA Nations League/i.test(name)) return true;
  return false;
}

function mapStatus(short) {
  if (!short) return 'scheduled';
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished';
  if (['1H', '2H', 'ET', 'BT', 'P', 'LIVE', 'HT'].includes(short)) return 'live';
  return 'scheduled';
}

async function apiGet(env, path, params = {}, rateLimit = null) {
  if (rateLimit) await rateLimit();
  const url = new URL(`https://v3.football.api-sports.io${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString(), {
    headers: { 'x-apisports-key': env.API_FOOTBALL_KEY || '' },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      detail = String(body || '')
        .replace(/\s+/g, ' ')
        .slice(0, 160);
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail ? `API-Football ${res.status}: ${detail}` : `API-Football ${res.status}`);
  }
  const json = await res.json();
  // api-sports sometimes returns 200 with errors object / empty when plan/key invalid
  if (json?.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors).length)) {
    const errObj = json.errors;
    const msg = Array.isArray(errObj)
      ? errObj.map(String).join('; ')
      : Object.entries(errObj)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
    throw new Error(`API-Football errors: ${msg.slice(0, 200)}`);
  }
  return json;
}

/** Probe key/plan before burning enrich budget. */
async function probeApiFootball(env, rateLimit = null) {
  const data = await apiGet(env, '/status', {}, rateLimit);
  const acc = data?.response?.account || data?.response || {};
  const req = data?.response?.requests || {};
  return {
    ok: true,
    plan: acc.plan || acc?.subscription?.plan || null,
    remaining: req.current != null && req.limit_day != null ? Number(req.limit_day) - Number(req.current) : null,
    limitDay: req.limit_day != null ? Number(req.limit_day) : null,
    current: req.current != null ? Number(req.current) : null,
  };
}

async function upsertTeamsAndLeague(db, item) {
  const leagueId = await store.upsertLeague(db, {
    name: item.league.name,
    country: item.league.country,
    logo_url: item.league.logo,
    api_id: item.league.id,
  });
  const homeId = await store.upsertTeam(db, {
    name: item.teams.home.name,
    logo_url: item.teams.home.logo,
    league_id: leagueId,
    api_id: item.teams.home.id,
  });
  const awayId = await store.upsertTeam(db, {
    name: item.teams.away.name,
    logo_url: item.teams.away.logo,
    league_id: leagueId,
    api_id: item.teams.away.id,
  });
  return { leagueId, homeId, awayId };
}

async function saveFixture(db, item) {
  const { leagueId, homeId, awayId } = await upsertTeamsAndLeague(db, item);
  const status = mapStatus(item.fixture.status.short);
  const matchId = await store.upsertFixture(db, {
    league_id: leagueId,
    home_team_id: homeId,
    away_team_id: awayId,
    match_date: item.fixture.date.replace('T', ' ').slice(0, 19),
    status,
    home_goals: item.goals.home,
    away_goals: item.goals.away,
    api_id: item.fixture.id,
  });

  if (status === 'finished' && item.goals.home != null && item.goals.away != null) {
    const matchDate = item.fixture.date.replace('T', ' ').slice(0, 19);
    await store.upsertStat(db, {
      team_id: homeId,
      match_id: matchId,
      goals_scored: item.goals.home,
      goals_conceded: item.goals.away,
      corners_for: null,
      corners_against: null,
      is_home: true,
      match_date: matchDate,
    });
    await store.upsertStat(db, {
      team_id: awayId,
      match_id: matchId,
      goals_scored: item.goals.away,
      goals_conceded: item.goals.home,
      corners_for: null,
      corners_against: null,
      is_home: false,
      match_date: matchDate,
    });
  }
  return matchId;
}

function findBet(bets, names) {
  const list = bets || [];
  const needles = (Array.isArray(names) ? names : [names]).map((n) =>
    String(n).toLowerCase()
  );
  const exact = list.find((b) => needles.includes(String(b.name || '').toLowerCase()));
  if (exact) return exact;
  // Fuzzy: AF often varies "Corners Over/Under" vs "Total Corners"
  return (
    list.find((b) => {
      const name = String(b.name || '').toLowerCase();
      return needles.some((n) => name.includes(n) || n.includes(name));
    }) || null
  );
}

function oddValue(bet, matcher) {
  if (!bet?.values?.length) return null;
  const hit = bet.values.find((v) => matcher(String(v.value || '')));
  if (!hit) return null;
  const n = Number(hit.odd);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/** Sportium → Codere → rest; used for merge fill order. */
function orderBookmakers(bookmakers) {
  const list = [...(bookmakers || [])];
  if (!list.length) return [];
  const prefer = ['sportium', 'codere'];
  const ranked = [];
  for (const needle of prefer) {
    const idx = list.findIndex((b) => String(b.name || '').toLowerCase().includes(needle));
    if (idx >= 0) ranked.push(list.splice(idx, 1)[0]);
  }
  return ranked.concat(list);
}

function extractOddsFields(bets) {
  const matchWinner = findBet(bets, ['Match Winner', '1x2']);
  const overUnder = findBet(bets, ['Goals Over/Under', 'Over/Under']);
  const btts = findBet(bets, ['Both Teams Score', 'Both Teams To Score', 'BTTS']);
  const totalShots = findBet(bets, [
    'Total Shots',
    'Shots Over/Under',
    'Total Shots Over/Under',
    'Match Shots',
  ]);
  const shotsOnTarget = findBet(bets, [
    'Shots on Target Over/Under',
    'Total Shots on Target',
    'Shots On Target',
    'Match Shots on Target',
  ]);
  const corners = findBet(bets, [
    'Corners Over Under',
    'Corners Over/Under',
    'Total Corners',
    'Corner Over Under',
    'Corners',
  ]);
  const cards = findBet(bets, [
    'Yellow Cards Over/Under',
    'Total Yellow Cards',
    'Yellow Cards',
  ]);
  return {
    home: oddValue(matchWinner, (v) => v === 'Home'),
    draw: oddValue(matchWinner, (v) => v === 'Draw'),
    away: oddValue(matchWinner, (v) => v === 'Away'),
    over15: oddValue(overUnder, (v) => /over\s*1\.5/i.test(v)),
    under15: oddValue(overUnder, (v) => /under\s*1\.5/i.test(v)),
    over25: oddValue(overUnder, (v) => /over\s*2\.5/i.test(v)),
    under25: oddValue(overUnder, (v) => /under\s*2\.5/i.test(v)),
    over35: oddValue(overUnder, (v) => /over\s*3\.5/i.test(v)),
    under35: oddValue(overUnder, (v) => /under\s*3\.5/i.test(v)),
    bttsYes: oddValue(btts, (v) => /^yes$/i.test(v.trim())),
    bttsNo: oddValue(btts, (v) => /^no$/i.test(v.trim())),
    shotsOver225: oddValue(totalShots, (v) => /over\s*22\.5/i.test(v)),
    shotsUnder225: oddValue(totalShots, (v) => /under\s*22\.5/i.test(v)),
    shotsOver255: oddValue(totalShots, (v) => /over\s*25\.5/i.test(v)),
    shotsUnder255: oddValue(totalShots, (v) => /under\s*25\.5/i.test(v)),
    sotOver75: oddValue(shotsOnTarget, (v) => /over\s*7\.5/i.test(v)),
    sotUnder75: oddValue(shotsOnTarget, (v) => /under\s*7\.5/i.test(v)),
    sotOver85: oddValue(shotsOnTarget, (v) => /over\s*8\.5/i.test(v)),
    sotUnder85: oddValue(shotsOnTarget, (v) => /under\s*8\.5/i.test(v)),
    sotOver95: oddValue(shotsOnTarget, (v) => /over\s*9\.5/i.test(v)),
    sotUnder95: oddValue(shotsOnTarget, (v) => /under\s*9\.5/i.test(v)),
    cornersOver85: oddValue(corners, (v) => /over\s*8\.5/i.test(v)),
    cornersUnder85: oddValue(corners, (v) => /under\s*8\.5/i.test(v)),
    cornersOver95: oddValue(corners, (v) => /over\s*9\.5/i.test(v)),
    cornersUnder95: oddValue(corners, (v) => /under\s*9\.5/i.test(v)),
    cornersOver105: oddValue(corners, (v) => /over\s*10\.5/i.test(v)),
    cornersUnder105: oddValue(corners, (v) => /under\s*10\.5/i.test(v)),
    cardsOver35: oddValue(cards, (v) => /over\s*3\.5/i.test(v)),
    cardsUnder35: oddValue(cards, (v) => /under\s*3\.5/i.test(v)),
    cardsOver45: oddValue(cards, (v) => /over\s*4\.5/i.test(v)),
    cardsUnder45: oddValue(cards, (v) => /under\s*4\.5/i.test(v)),
  };
}

/** Fill null markets from next bookmakers (Sportium/Codere first). */
function mergeOddsFromBookmakers(bookmakers) {
  const ordered = orderBookmakers(bookmakers);
  if (!ordered.length) return null;
  const keys = [
    'home',
    'draw',
    'away',
    'over15',
    'under15',
    'over25',
    'under25',
    'over35',
    'under35',
    'bttsYes',
    'bttsNo',
    'shotsOver225',
    'shotsUnder225',
    'shotsOver255',
    'shotsUnder255',
    'sotOver75',
    'sotUnder75',
    'sotOver85',
    'sotUnder85',
    'sotOver95',
    'sotUnder95',
    'cornersOver85',
    'cornersUnder85',
    'cornersOver95',
    'cornersUnder95',
    'cornersOver105',
    'cornersUnder105',
    'cardsOver35',
    'cardsUnder35',
    'cardsOver45',
    'cardsUnder45',
  ];
  const out = Object.fromEntries(keys.map((k) => [k, null]));
  let bookmakerName = ordered[0]?.name || 'avg';
  for (const bm of ordered) {
    const fields = extractOddsFields(bm.bets || []);
    let filled = false;
    for (const k of keys) {
      if (out[k] == null && fields[k] != null) {
        out[k] = fields[k];
        filled = true;
      }
    }
    if (filled && bookmakerName === (ordered[0]?.name || 'avg')) {
      bookmakerName = bm.name || bookmakerName;
    }
  }
  if (out.home == null && out.draw == null && out.away == null && out.over25 == null) return null;
  return { ...out, bookmaker: bookmakerName };
}

async function syncOddsForMatch(env, db, apiFixtureId, localMatchId, rateLimit = null) {
  try {
    const data = await apiGet(env, '/odds', { fixture: apiFixtureId }, rateLimit);
    const book = (data.response || [])[0];
    if (!book?.bookmakers?.length) {
      await store.upsertOdds(db, {
        match_id: localMatchId,
        bookmaker: 'API-Football: no market',
        home_odds: null,
        draw_odds: null,
        away_odds: null,
        over25_odds: null,
        under25_odds: null,
      });
      return false;
    }
    const merged = mergeOddsFromBookmakers(book.bookmakers);
    if (!merged) {
      await store.upsertOdds(db, {
        match_id: localMatchId,
        bookmaker: 'API-Football: no market',
        home_odds: null,
        draw_odds: null,
        away_odds: null,
        over25_odds: null,
        under25_odds: null,
      });
      return false;
    }
    await store.upsertOdds(db, {
      match_id: localMatchId,
      bookmaker: merged.bookmaker || 'avg',
      home_odds: merged.home,
      draw_odds: merged.draw,
      away_odds: merged.away,
      over15_odds: merged.over15,
      under15_odds: merged.under15,
      over25_odds: merged.over25,
      under25_odds: merged.under25,
      over35_odds: merged.over35,
      under35_odds: merged.under35,
      btts_yes_odds: merged.bttsYes,
      btts_no_odds: merged.bttsNo,
      shots_over225_odds: merged.shotsOver225,
      shots_under225_odds: merged.shotsUnder225,
      shots_over255_odds: merged.shotsOver255,
      shots_under255_odds: merged.shotsUnder255,
      sot_over75_odds: merged.sotOver75,
      sot_under75_odds: merged.sotUnder75,
      sot_over85_odds: merged.sotOver85,
      sot_under85_odds: merged.sotUnder85,
      sot_over95_odds: merged.sotOver95,
      sot_under95_odds: merged.sotUnder95,
      corners_over85_odds: merged.cornersOver85,
      corners_under85_odds: merged.cornersUnder85,
      corners_over95_odds: merged.cornersOver95,
      corners_under95_odds: merged.cornersUnder95,
      corners_over105_odds: merged.cornersOver105,
      corners_under105_odds: merged.cornersUnder105,
      cards_over35_odds: merged.cardsOver35,
      cards_under35_odds: merged.cardsUnder35,
      cards_over45_odds: merged.cardsOver45,
      cards_under45_odds: merged.cardsUnder45,
    });
    return true;
  } catch (err) {
    const message = err?.message || String(err);
    if (/API-Football (401|403)/.test(message) || /errors:.*(token|subscription|plan)/i.test(message)) {
      throw err;
    }
    return false;
  }
}

function normalizeTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamNameScore(a, b) {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 80;
  const wa = new Set(na.split(' ').filter((w) => w.length > 2));
  const wb = new Set(nb.split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return Math.round((100 * inter) / Math.max(wa.size, wb.size));
}

function findBestFixtureMatch(items, homeName, awayName) {
  let best = null;
  let bestScore = 0;
  for (const item of items) {
    const hs = teamNameScore(homeName, item.teams?.home?.name);
    const as = teamNameScore(awayName, item.teams?.away?.name);
    const score = Math.min(hs, as);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 50 ? best : null;
}

/** Significant words of a team name (drops "fc", "cf", "club", numbers). */
function nameTokens(name) {
  return new Set(
    normalizeTeamName(name)
      .split(' ')
      .filter((w) => w.length > 2)
  );
}

/**
 * Inverted index of FotMob live/finished matches by team name token.
 * Avoids scanning the whole worldwide live list for every row.
 */
function buildLiveNameIndex(matches) {
  const byToken = new Map();
  for (const m of matches || []) {
    for (const token of nameTokens(m.homeName)) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(m);
    }
    for (const token of nameTokens(m.awayName)) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(m);
    }
  }
  return byToken;
}

/** FotMob live matches that share a token with both teams of the row. */
function liveCandidatesFor(index, homeName, awayName) {
  if (!index || !index.size) return [];
  const homeTokens = nameTokens(homeName);
  const awayTokens = nameTokens(awayName);
  if (!homeTokens.size || !awayTokens.size) return [];

  const pool = new Set();
  for (const token of homeTokens) {
    for (const m of index.get(token) || []) pool.add(m);
  }
  for (const token of awayTokens) {
    for (const m of index.get(token) || []) pool.add(m);
  }

  const out = [];
  for (const m of pool) {
    let homeHit = false;
    for (const t of nameTokens(m.homeName)) {
      if (homeTokens.has(t)) {
        homeHit = true;
        break;
      }
    }
    if (!homeHit) continue;
    let awayHit = false;
    for (const t of nameTokens(m.awayName)) {
      if (awayTokens.has(t)) {
        awayHit = true;
        break;
      }
    }
    if (!awayHit) continue;
    out.push({ _fm: m, teams: { home: { name: m.homeName }, away: { name: m.awayName } } });
  }
  return out;
}

const ODDS_ENRICH_LIMIT = 20;
const STATS_ENRICH_LIMIT = 8;
const AF_FREE_RESERVE_REQUESTS = 10;

/** Conservative per-run split for API-Football's 100-request free daily plan. */
function planApiFootballEnrichLimits(remainingRequests) {
  if (remainingRequests == null || !Number.isFinite(Number(remainingRequests))) {
    return { oddsLimit: 15, statsLimit: 5, estimatedRequests: 41 };
  }
  const usable = Math.max(0, Math.floor(Number(remainingRequests)) - AF_FREE_RESERVE_REQUESTS);
  const fixtureSlots = Math.floor(usable / 2); // discovery + odds/stats call
  const oddsLimit = Math.min(ODDS_ENRICH_LIMIT, Math.ceil(fixtureSlots * 0.75));
  const statsLimit = Math.min(STATS_ENRICH_LIMIT, Math.floor(fixtureSlots * 0.25));
  return {
    oddsLimit,
    statsLimit,
    estimatedRequests: 1 + 2 * (oddsLimit + statsLimit), // includes /status probe
  };
}

/**
 * After FixtureDownload sync: attach real odds via API-Football when key is set.
 */
async function enrichOddsFromApiFootball(env, db, limit = ODDS_ENRICH_LIMIT, rateLimit = null) {
  const rows = await store.getUpcomingForOddsEnrichment(db, limit, WINDOW_DAYS);
  let oddsSynced = 0;
  let logosSynced = 0;
  let nameMiss = 0;
  let emptyOdds = 0;
  let directHits = 0;
  let batchErrors = 0;
  let lastBatchError = null;
  const syncedMatchIds = [];

  // 1) Direct AF fixture id path (no name match)
  const needFixtures = [];
  for (const m of rows) {
    if (oddsSynced >= limit) break;
    const afId = m.af_fixture_id != null ? Number(m.af_fixture_id) : null;
    if (Number.isFinite(afId) && afId > 0) {
      const ok = await syncOddsForMatch(env, db, afId, m.id, rateLimit);
      if (ok) {
        oddsSynced += 1;
        directHits += 1;
        syncedMatchIds.push(m.id);
      } else {
        emptyOdds += 1;
      }
    } else {
      needFixtures.push(m);
    }
  }

  // 2) Name-match via /fixtures?date&league for the rest
  const byDateLeague = new Map();
  for (const m of needFixtures) {
    if (m.league_api_id == null || !Number.isFinite(Number(m.league_api_id))) {
      nameMiss += 1;
      continue;
    }
    const date = String(m.match_date).slice(0, 10);
    const key = `${date}:${m.league_api_id}`;
    if (!byDateLeague.has(key)) byDateLeague.set(key, []);
    byDateLeague.get(key).push(m);
  }

  for (const [key, matches] of byDateLeague) {
    const [date, league] = key.split(':');
    try {
      const data = await apiGet(env, '/fixtures', { date, league: Number(league) }, rateLimit);
      const items = data.response || [];
      for (const m of matches) {
        if (oddsSynced >= limit) {
          return {
            oddsSynced,
            logosSynced,
            syncedMatchIds,
            nameMiss,
            emptyOdds,
            directHits,
            batchErrors,
            lastBatchError,
            queued: rows.length,
          };
        }
        const best = findBestFixtureMatch(items, m.home_name, m.away_name);
        if (!best?.fixture?.id) {
          nameMiss += 1;
          continue;
        }
        const afFixtureId = best.fixture.id;
        try {
          await store.setMatchAfFixtureId(db, m.id, afFixtureId);
        } catch (_) {
          /* column may be missing until migration */
        }
        const homeLogo = best.teams?.home?.logo || null;
        const awayLogo = best.teams?.away?.logo || null;
        if (homeLogo && m.home_team_id) {
          await store.updateTeamLogo(db, m.home_team_id, homeLogo);
          logosSynced += 1;
        }
        if (awayLogo && m.away_team_id) {
          await store.updateTeamLogo(db, m.away_team_id, awayLogo);
          logosSynced += 1;
        }
        const ok = await syncOddsForMatch(env, db, afFixtureId, m.id, rateLimit);
        if (ok) {
          oddsSynced += 1;
          syncedMatchIds.push(m.id);
        } else {
          emptyOdds += 1;
        }
      }
    } catch (err) {
      batchErrors += 1;
      lastBatchError = err.message || String(err);
      // Hard fail on auth/plan — no point burning the rest of the batches
      if (/API-Football (401|403)/.test(lastBatchError) || /errors:.*(token|request|subscription|plan)/i.test(lastBatchError)) {
        break;
      }
    }
  }
  return {
    oddsSynced,
    logosSynced,
    syncedMatchIds,
    nameMiss,
    emptyOdds,
    directHits,
    batchErrors,
    lastBatchError,
    queued: rows.length,
  };
}

/**
 * Persist pre-mapped fixtures (FotMob intl / Segunda) into D1.
 * @param {'flag'|'club'} logoMode
 */
async function persistMappedFixtures(db, fixtures, logoMode = 'flag') {
  if (!fixtures.length) return { saved: 0 };

  const uniqueLeagues = new Map();
  for (const fx of fixtures) {
    if (!uniqueLeagues.has(fx.leagueApiId)) {
      uniqueLeagues.set(fx.leagueApiId, {
        name: fx.leagueName,
        country: fx.country,
        api_id: fx.leagueApiId,
      });
    }
  }

  await db.batch(
    [...uniqueLeagues.values()].map((l) => ({
      sql: `INSERT INTO leagues (name, country, logo_url, api_id) VALUES (?, ?, NULL, ?)
            ON CONFLICT(api_id) DO UPDATE SET name=excluded.name, country=excluded.country`,
      params: [l.name, l.country, l.api_id],
    }))
  );

  const leagueKeys = [...uniqueLeagues.keys()];
  const leagueByApi = new Map();
  for (let i = 0; i < leagueKeys.length; i += 40) {
    const slice = leagueKeys.slice(i, i + 40);
    const rows = await db.all(
      `SELECT id, api_id FROM leagues WHERE api_id IN (${slice.map(() => '?').join(',')})`,
      ...slice
    );
    for (const r of rows) leagueByApi.set(r.api_id, r.id);
  }

  const teamDefs = new Map();
  for (const fx of fixtures) {
    const leagueId = leagueByApi.get(fx.leagueApiId);
    if (leagueId == null || !fx.homeName || !fx.awayName) continue;
    for (const [name, apiId, fxLogo] of [
      [fx.homeName, fx.homeTeamApiId, fx.homeLogoUrl],
      [fx.awayName, fx.awayTeamApiId, fx.awayLogoUrl],
    ]) {
      const key = `${leagueId}:${name.toLowerCase()}`;
      if (!teamDefs.has(key)) {
        const logo =
          fxLogo ||
          (logoMode === 'club'
            ? clubLogoUrl(name) || flagLogoForTeamName(name)
            : flagLogoForTeamName(name) || clubLogoUrl(name));
        teamDefs.set(key, {
          name,
          leagueId,
          api_id: apiId,
          logo,
        });
      } else if (fxLogo && !teamDefs.get(key).logo) {
        teamDefs.get(key).logo = fxLogo;
      }
    }
  }

  const TEAM_CHUNK = 40;
  const teamEntries = [...teamDefs.values()];
  for (let i = 0; i < teamEntries.length; i += TEAM_CHUNK) {
    const slice = teamEntries.slice(i, i + TEAM_CHUNK);
    await db.batch(
      slice.map((t) => ({
        sql: `INSERT INTO teams (name, logo_url, league_id, api_id) VALUES (?, ?, ?, ?)
              ON CONFLICT(api_id) DO UPDATE SET
                name=excluded.name,
                league_id=excluded.league_id,
                logo_url=COALESCE(excluded.logo_url, teams.logo_url)`,
        params: [t.name, t.logo, t.leagueId, t.api_id],
      }))
    );
  }

  const leagueIds = [...new Set([...teamDefs.values()].map((t) => t.leagueId))];
  const teamIdByKey = new Map();
  for (let i = 0; i < leagueIds.length; i += 40) {
    const slice = leagueIds.slice(i, i + 40);
    const rows = await db.all(
      `SELECT id, league_id, name FROM teams WHERE league_id IN (${slice.map(() => '?').join(',')})`,
      ...slice
    );
    for (const row of rows) {
      teamIdByKey.set(`${row.league_id}:${String(row.name).toLowerCase()}`, row.id);
    }
  }

  const MATCH_UPSERT = `INSERT INTO matches
    (league_id, home_team_id, away_team_id, match_date, status, home_goals, away_goals, elapsed_minute, api_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(api_id) DO UPDATE SET
     league_id=excluded.league_id,
     home_team_id=excluded.home_team_id,
     away_team_id=excluded.away_team_id,
     match_date=excluded.match_date,
     status=excluded.status,
     home_goals=excluded.home_goals,
     away_goals=excluded.away_goals,
     elapsed_minute=excluded.elapsed_minute`;

  const statements = [];
  for (const fx of fixtures) {
    const leagueId = leagueByApi.get(fx.leagueApiId);
    if (leagueId == null) continue;
    const homeId = teamIdByKey.get(`${leagueId}:${fx.homeName.toLowerCase()}`);
    const awayId = teamIdByKey.get(`${leagueId}:${fx.awayName.toLowerCase()}`);
    if (homeId == null || awayId == null) continue;
    statements.push({
      sql: MATCH_UPSERT,
      params: [
        leagueId,
        homeId,
        awayId,
        fx.matchDate,
        fx.status,
        fx.homeGoals,
        fx.awayGoals,
        fx.elapsed_minute ?? null,
        fx.api_id,
      ],
    });
  }

  for (let i = 0; i < statements.length; i += 40) {
    await db.batch(statements.slice(i, i + 40));
  }

  await store.rebuildFdTeamStats(db);
  return { saved: statements.length };
}

/**
 * Import national Friendlies via FotMob — no API key.
 * UNL / Champions / Europa come from FixtureDownload. Batched D1 writes.
 */
async function enrichInternationalsFromFotmob(db) {
  const { fixtures, errors } = await fetchInternationalFixtures();
  if (!fixtures.length) return { saved: 0, errors };
  const persisted = await persistMappedFixtures(db, fixtures, 'flag');
  return { saved: persisted.saved, errors };
}

/** Segunda División (LaLiga2) via FotMob — no FixtureDownload feed. */
async function enrichSegundaFromFotmob(db) {
  const { fixtures, errors } = await fetchSegundaFixtures();
  if (!fixtures.length) return { saved: 0, errors };
  const persisted = await persistMappedFixtures(db, fixtures, 'club');
  return { saved: persisted.saved, errors };
}

function statValue(statistics, typeName) {
  const row = (statistics || []).find((s) => s.type === typeName);
  if (!row || row.value == null || row.value === '') return null;
  const n = Number(row.value);
  return Number.isNaN(n) ? null : n;
}

/**
 * Pull Corner Kicks + Yellow Cards (+ shots) for finished matches missing those stats.
 * @param {number} limit max fixtures to enrich (subrequest budget)
 */
async function enrichStatsFromApiFootball(env, db, limit = STATS_ENRICH_LIMIT, rateLimit = null) {
  const rows = await store.getFinishedForStatsEnrichment(db, limit, 90);
  if (!rows.length) return 0;

  const byDateLeague = new Map();
  for (const m of rows) {
    const date = String(m.match_date).slice(0, 10);
    const key = `${date}:${m.league_api_id}`;
    if (!byDateLeague.has(key)) byDateLeague.set(key, []);
    byDateLeague.get(key).push(m);
  }

  let updated = 0;
  for (const [key, matches] of byDateLeague) {
    if (updated >= limit) break;
    const [date, league] = key.split(':');
    let items = [];
    try {
      const data = await apiGet(env, '/fixtures', { date, league: Number(league) }, rateLimit);
      items = data.response || [];
    } catch (_) {
      continue;
    }
    for (const m of matches) {
      if (updated >= limit) break;
      const best = findBestFixtureMatch(items, m.home_name, m.away_name);
      if (!best?.fixture?.id) continue;
      try {
        const statsData = await apiGet(
          env,
          '/fixtures/statistics',
          { fixture: best.fixture.id },
          rateLimit
        );
        const blocks = statsData.response || [];
        if (blocks.length < 2) continue;
        const homeBlock =
          blocks.find((b) => teamNameScore(m.home_name, b.team?.name) >= 50) || blocks[0];
        const awayBlock =
          blocks.find((b) => b !== homeBlock && teamNameScore(m.away_name, b.team?.name) >= 50) ||
          blocks[1];
        const homeCorners = statValue(homeBlock.statistics, 'Corner Kicks');
        const awayCorners = statValue(awayBlock.statistics, 'Corner Kicks');
        const homeYellows = statValue(homeBlock.statistics, 'Yellow Cards');
        const awayYellows = statValue(awayBlock.statistics, 'Yellow Cards');
        const homeReds = statValue(homeBlock.statistics, 'Red Cards');
        const awayReds = statValue(awayBlock.statistics, 'Red Cards');
        const homeFouls = statValue(homeBlock.statistics, 'Fouls');
        const awayFouls = statValue(awayBlock.statistics, 'Fouls');
        const homeShotsTotal = statValue(homeBlock.statistics, 'Total Shots');
        const awayShotsTotal = statValue(awayBlock.statistics, 'Total Shots');
        const homeSot = statValue(homeBlock.statistics, 'Shots on Goal');
        const awaySot = statValue(awayBlock.statistics, 'Shots on Goal');
        const homeShots = homeShotsTotal;
        const awayShots = awayShotsTotal;
        if (
          homeCorners == null &&
          awayCorners == null &&
          homeYellows == null &&
          awayYellows == null &&
          homeShots == null &&
          awayShots == null &&
          homeSot == null &&
          awaySot == null
        ) {
          continue;
        }
        const matchDate = String(m.match_date).replace('T', ' ').slice(0, 19);
        await store.upsertStat(db, {
          team_id: m.home_team_id,
          match_id: m.id,
          goals_scored: m.home_goals,
          goals_conceded: m.away_goals,
          corners_for: homeCorners,
          corners_against: awayCorners,
          yellows_for: homeYellows,
          yellows_against: awayYellows,
          reds_for: homeReds,
          reds_against: awayReds,
          fouls_for: homeFouls,
          fouls_against: awayFouls,
          shots_for: homeShots,
          shots_against: awayShots,
          shots_on_target_for: homeSot,
          shots_on_target_against: awaySot,
          is_home: true,
          match_date: matchDate,
        });
        await store.upsertStat(db, {
          team_id: m.away_team_id,
          match_id: m.id,
          goals_scored: m.away_goals,
          goals_conceded: m.home_goals,
          corners_for: awayCorners,
          corners_against: homeCorners,
          yellows_for: awayYellows,
          yellows_against: homeYellows,
          reds_for: awayReds,
          reds_against: homeReds,
          fouls_for: awayFouls,
          fouls_against: homeFouls,
          shots_for: awayShots,
          shots_against: homeShots,
          shots_on_target_for: awaySot,
          shots_on_target_against: homeSot,
          is_home: false,
          match_date: matchDate,
        });
        updated += 1;
      } catch (_) {
        /* skip fixture */
      }
    }
  }
  return updated;
}

async function persistFotmobStats(db, match, details) {
  const stats = normalizeFotmobStats(details);
  const values = [
    stats.home.corners,
    stats.away.corners,
    stats.home.yellows,
    stats.away.yellows,
    stats.home.shots,
    stats.away.shots,
    stats.home.shotsOnTarget,
    stats.away.shotsOnTarget,
  ];
  if (values.every((value) => value == null)) return false;
  const matchDate = String(match.match_date).replace('T', ' ').slice(0, 19);
  await store.upsertStat(db, {
    team_id: match.home_team_id,
    match_id: match.id,
    goals_scored: match.home_goals,
    goals_conceded: match.away_goals,
    corners_for: stats.home.corners,
    corners_against: stats.away.corners,
    yellows_for: stats.home.yellows,
    yellows_against: stats.away.yellows,
    shots_for: stats.home.shots,
    shots_against: stats.away.shots,
    shots_on_target_for: stats.home.shotsOnTarget,
    shots_on_target_against: stats.away.shotsOnTarget,
    is_home: true,
    match_date: matchDate,
  });
  await store.upsertStat(db, {
    team_id: match.away_team_id,
    match_id: match.id,
    goals_scored: match.away_goals,
    goals_conceded: match.home_goals,
    corners_for: stats.away.corners,
    corners_against: stats.home.corners,
    yellows_for: stats.away.yellows,
    yellows_against: stats.home.yellows,
    shots_for: stats.away.shots,
    shots_against: stats.home.shots,
    shots_on_target_for: stats.away.shotsOnTarget,
    shots_on_target_against: stats.home.shotsOnTarget,
    is_home: false,
    match_date: matchDate,
  });
  return true;
}

/** No-key path: FotMob supplies corners, yellows, total shots and true SOT. */
async function enrichStatsFromFotmob(db, limit = 8, lookbackDays = 60) {
  // Fetch a wider candidate pool so a few unmatched FotMob names do not block
  // all older enrichable fixtures forever.
  const rows = await store.getFinishedForFotmobStatsEnrichment(
    db,
    Math.min(30, Math.max(limit, limit * 4)),
    lookbackDays
  );
  if (!rows.length) return { updated: 0, errors: [] };
  const errors = [];
  const fixtures = [];
  const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const offsets = [
    ...new Set(
      rows.map((row) => {
        const rowMs = Date.parse(`${String(row.match_date).slice(0, 10)}T00:00:00Z`);
        return Math.round((rowMs - todayMs) / 86400000);
      })
    ),
  ].filter((offset) => Number.isFinite(offset) && offset < 0);
  for (const offset of offsets) {
    const snapshot = await fetchFotmobLiveSnapshot(offset, offset);
    fixtures.push(...(snapshot.fixtures || []));
    errors.push(...(snapshot.errors || []));
  }
  let updated = 0;
  for (const match of rows) {
    if (updated >= limit) break;
    const best = findBestFixtureMatch(
      fixtures.map((fx) => ({
        ...fx,
        teams: { home: { name: fx.homeName }, away: { name: fx.awayName } },
      })),
      match.home_name,
      match.away_name
    );
    const fotmobId = best ? fotmobMatchIdFromApiId(best.api_id) : null;
    if (!fotmobId) continue;
    try {
      const details = await fetchFotmobMatchDetails(fotmobId);
      if (await persistFotmobStats(db, match, details)) updated += 1;
    } catch (err) {
      errors.push({ source: 'fotmob-stats', matchId: match.id, error: err.message || String(err) });
    }
  }
  return { updated, errors };
}

/**
 * Batched FixtureDownload sync — upcoming + finished history, purge demo seed.
 * Predictions are computed lazily on API read (not here).
 */
async function runFixtureDownloadSync(db) {
  const { fixtures, upcomingCount, historyCount, errors } = await fetchAllWindowFixtures();
  if (!fixtures.length) {
    return {
      ok: true,
      mode: 'demo',
      savedFixtures: 0,
      savedHistory: 0,
      predicted: 0,
      errors,
      message: 'FixtureDownload no devolvió partidos; se mantienen datos demo.',
    };
  }

  const removedDemo = await store.deleteAllDemoMatches(db);
  await store.purgeOrphanPredictions(db);

  const uniqueLeagues = new Map();
  for (const fx of fixtures) {
    if (!uniqueLeagues.has(fx.leagueApiId)) {
      uniqueLeagues.set(fx.leagueApiId, {
        name: fx.leagueName,
        country: fx.country,
        api_id: fx.leagueApiId,
      });
    }
  }

  await db.batch(
    [...uniqueLeagues.values()].map((l) => ({
      sql: `INSERT INTO leagues (name, country, logo_url, api_id) VALUES (?, ?, NULL, ?)
            ON CONFLICT(api_id) DO UPDATE SET name=excluded.name, country=excluded.country`,
      params: [l.name, l.country, l.api_id],
    }))
  );

  const leagueRows = await db.all(
    `SELECT id, api_id FROM leagues WHERE api_id IN (${[...uniqueLeagues.keys()].map(() => '?').join(',')})`,
    ...uniqueLeagues.keys()
  );
  const leagueByApi = new Map(leagueRows.map((r) => [r.api_id, r.id]));

  const teamDefs = new Map();
  for (const fx of fixtures) {
    if (!fx.homeName || !fx.awayName) continue;
    const leagueId = leagueByApi.get(fx.leagueApiId);
    const isIntl = String(fx.country || '') === 'World' || INTERNATIONAL_LEAGUE_IDS.includes(fx.leagueApiId);
    for (const name of [fx.homeName, fx.awayName]) {
      const key = `${leagueId}:${name.toLowerCase()}`;
      if (!teamDefs.has(key)) {
        teamDefs.set(key, {
          name,
          leagueId,
          api_id: teamApiId(fx.leagueApiId, name),
          logo: isIntl ? flagLogoForTeamName(name) : clubLogoUrl(name),
        });
      }
    }
  }

  const leagueIds = [...new Set([...teamDefs.values()].map((t) => t.leagueId))];
  const existingTeams = leagueIds.length
    ? await db.all(
        `SELECT id, league_id, name FROM teams WHERE league_id IN (${leagueIds.map(() => '?').join(',')})`,
        ...leagueIds
      )
    : [];
  const teamIdByKey = new Map();
  for (const row of existingTeams) {
    teamIdByKey.set(`${row.league_id}:${String(row.name).toLowerCase()}`, row.id);
  }

  const missingTeams = [...teamDefs.entries()].filter(([key]) => !teamIdByKey.has(key));
  if (missingTeams.length) {
    const TEAM_CHUNK = 40;
    for (let i = 0; i < missingTeams.length; i += TEAM_CHUNK) {
      const slice = missingTeams.slice(i, i + TEAM_CHUNK);
      await db.batch(
        slice.map(([, t]) => ({
          sql: `INSERT INTO teams (name, logo_url, league_id, api_id) VALUES (?, ?, ?, ?)
                ON CONFLICT(api_id) DO UPDATE SET
                  name=excluded.name,
                  league_id=excluded.league_id,
                  logo_url=COALESCE(teams.logo_url, excluded.logo_url)`,
          params: [t.name, t.logo, t.leagueId, t.api_id],
        }))
      );
    }
    const refreshed = await db.all(
      `SELECT id, league_id, name FROM teams WHERE league_id IN (${leagueIds.map(() => '?').join(',')})`,
      ...leagueIds
    );
    teamIdByKey.clear();
    for (const row of refreshed) {
      teamIdByKey.set(`${row.league_id}:${String(row.name).toLowerCase()}`, row.id);
    }
  }

  const MATCH_UPSERT = `INSERT INTO matches
    (league_id, home_team_id, away_team_id, match_date, status, home_goals, away_goals, api_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(api_id) DO UPDATE SET
     league_id=excluded.league_id,
     home_team_id=excluded.home_team_id,
     away_team_id=excluded.away_team_id,
     match_date=excluded.match_date,
     status=excluded.status,
     home_goals=excluded.home_goals,
     away_goals=excluded.away_goals`;

  const statements = [];
  let savedUpcoming = 0;
  let savedHistory = 0;
  for (const fx of fixtures) {
    if (!fx.homeName || !fx.awayName) continue;
    const leagueId = leagueByApi.get(fx.leagueApiId);
    const homeId = teamIdByKey.get(`${leagueId}:${fx.homeName.toLowerCase()}`);
    const awayId = teamIdByKey.get(`${leagueId}:${fx.awayName.toLowerCase()}`);
    if (homeId == null || awayId == null) continue;
    statements.push({
      sql: MATCH_UPSERT,
      params: [
        leagueId,
        homeId,
        awayId,
        fx.matchDate,
        fx.status,
        fx.homeGoals,
        fx.awayGoals,
        fx.api_id,
      ],
    });
    if (fx.status === 'finished') savedHistory += 1;
    else savedUpcoming += 1;
  }

  const CHUNK = 40;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.batch(statements.slice(i, i + CHUNK));
  }

  const statsRows = await store.rebuildFdTeamStats(db);

  return {
    ok: true,
    mode: 'fixturedownload',
    savedFixtures: savedUpcoming,
    savedHistory,
    statsRows,
    removedDemo,
    upcomingCount,
    historyCount,
    predicted: 0,
    note: 'Historial real importado; predicciones se reutilizan (solo huérfanas purgadas)',
    errors,
  };
}

async function runApiFootballSync(env, db) {
  const leagues = getLeagueIds(env);
  const upcomingDates = dateOffsets(0, WINDOW_DAYS);
  const yesterday = dateOffsets(-1, -1)[0];

  let savedFixtures = 0;
  let savedYday = 0;
  const upcomingMatchIds = [];

  for (const league of leagues) {
    try {
      for (const date of upcomingDates) {
        const data = await apiGet(env, '/fixtures', { date, league });
        for (const item of data.response || []) {
          const id = await saveFixture(db, item);
          upcomingMatchIds.push(id);
          savedFixtures += 1;
          if (mapStatus(item.fixture.status.short) === 'scheduled') {
            await syncOddsForMatch(env, db, item.fixture.id, id);
          }
        }
      }
      const ydayData = await apiGet(env, '/fixtures', {
        date: yesterday,
        status: 'FT',
        league,
      });
      for (const item of ydayData.response || []) {
        await saveFixture(db, item);
        savedYday += 1;
      }
    } catch (err) {
      console.log(`sync league ${league} error: ${err.message}`);
    }
  }

  const uniqueIds = [...new Set(upcomingMatchIds)];
  await predictMany(db, uniqueIds);
  return {
    ok: true,
    mode: 'api',
    savedFixtures,
    savedYday,
    predicted: uniqueIds.length,
  };
}

export async function runDailySync(env, db) {
  // FixtureDownload is always primary (honest club calendar + history).
  const result = await runFixtureDownloadSync(db);
  // Selecciones (friendlies) — FotMob, sin key
  const intl = await enrichInternationalsFromFotmob(db);
  let internationalsSynced = intl.saved || 0;
  // Segunda División (LaLiga2) — FotMob (no hay feed FD)
  const segunda = await enrichSegundaFromFotmob(db);
  let segundaSynced = segunda.saved || 0;
  const fotmobStats = await enrichStatsFromFotmob(db, 8, 60);

  const hasKey = Boolean(env.API_FOOTBALL_KEY && String(env.API_FOOTBALL_KEY).trim());
  // AF odds/stats van en cron/endpoint aparte (cupo subrequests)
  const oddsSynced = 0;
  const statsSynced = fotmobStats.updated || 0;
  const afError = hasKey ? 'use_sync_enrich' : null;
  // Warm tips so best-bets / combos / listado no hacen timeout en frío
  const upcomingIds = await store.getScheduledUpcomingIds(db, WINDOW_DAYS);
  const existing = await store.getPredictionsByMatchIds(db, upcomingIds);
  const toPredict = [];
  const trivial = [];
  for (const id of upcomingIds) {
    const p = existing.get(id);
    if (!p) {
      toPredict.push(id);
      continue;
    }
    const primary = p.suggested_bet != null ? String(p.suggested_bet) : '';
    const secondary = p.secondary_bet != null ? String(p.secondary_bet) : '';
    if (primary === 'UNDER_35' || secondary === 'UNDER_35') {
      trivial.push({ id, conf: Number(p.confidence_score) || 0 });
    }
  }
  trivial.sort((a, b) => b.conf - a.conf);
  const diversityRows = await store.getScheduledTipRows(db, WINDOW_DAYS);
  const diversityIds = dailyDiversityRebalanceIds(diversityRows, 40);
  const warmIds = [...new Set([
    ...toPredict,
    ...diversityIds,
    ...trivial.map((x) => x.id),
  ])].slice(0, 40);
  let predicted = 0;
  if (warmIds.length) {
    await predictMany(db, warmIds);
    predicted = warmIds.length;
  }
  const now = new Date().toISOString();
  await store.setMeta(db, 'last_sync_at', now);
  await store.setMeta(db, 'sync_started_at', '');
  const mode = 'fixturedownload+fotmob';
  await store.setMeta(db, 'last_sync_mode', mode);
  let logosBackfilled = 0;
  try {
    logosBackfilled = await store.backfillMissingTeamLogos(db, resolveTeamLogoUrl);
  } catch (_) {
    /* ignore logo backfill errors */
  }
  let tipsBackfilled = 0;
  let tipOddsBackfilled = 0;
  let tipsSettled = 0;
  let calibration = null;
  try {
    tipsBackfilled = await store.backfillPendingTips(db);
    tipOddsBackfilled = await store.backfillTipOddsBands(db);
    tipsSettled = await store.settlePendingTips(db);
    calibration = await fitTipCalibration(db);
    try {
      await store.settlePendingCombos(db, 40);
    } catch (_) {
      /* ignore combo ledger */
    }
  } catch (_) {
    /* ignore tip maintenance errors */
  }
  let ratingsMaint = null;
  try {
    ratingsMaint = await maintainTeamRatings(db);
  } catch (_) {
    ratingsMaint = { mode: 'skip' };
  }
  return {
    ...result,
    mode,
    oddsEnabled: hasKey,
    oddsSynced,
    statsSynced,
    internationalsSynced,
    internationalErrors: intl.errors || [],
    segundaSynced,
    segundaErrors: segunda.errors || [],
    fotmobStatsErrors: fotmobStats.errors || [],
    afError,
    predicted,
    tipsDiversityRebalanced: diversityIds.filter((id) => warmIds.includes(id)).length,
    logosBackfilled,
    tipsBackfilled,
    tipOddsBackfilled,
    tipsSettled,
    ratingsMaint,
    calibrationUpdatedAt: calibration?.updatedAt || null,
    calibrationDecided: calibration?.decided ?? null,
    lastSyncAt: now,
    windowDays: WINDOW_DAYS,
  };
}

/** Solo odds + stats API-Football (cron 06:30 / POST /sync/enrich). */
export async function runAfEnrichOnly(env, db) {
  const hasKey = Boolean(env.API_FOOTBALL_KEY && String(env.API_FOOTBALL_KEY).trim());
  if (!hasKey) {
    return {
      ok: false,
      mode: 'af-enrich',
      error: 'Sin API_FOOTBALL_KEY. wrangler secret put API_FOOTBALL_KEY',
      statsSynced: 0,
      oddsSynced: 0,
      tipsRefreshed: 0,
    };
  }
  let statsSynced = 0;
  let oddsSynced = 0;
  let logosSynced = 0;
  let tipsRefreshed = 0;
  let nameMiss = 0;
  let emptyOdds = 0;
  let directHits = 0;
  let queued = 0;
  let batchErrors = 0;
  let afProbe = null;
  let afError = null;
  let quotaPlan = null;
  const now = new Date().toISOString();
  try {
    const rateLimit = createApiFootballLimiter();
    try {
      afProbe = await probeApiFootball(env, rateLimit);
    } catch (probeErr) {
      afError = probeErr.message || String(probeErr);
      throw probeErr;
    }
    quotaPlan = planApiFootballEnrichLimits(afProbe.remaining);
    if (quotaPlan.statsLimit > 0) {
      statsSynced = await enrichStatsFromApiFootball(env, db, quotaPlan.statsLimit, rateLimit);
    }
    const oddsResult = quotaPlan.oddsLimit > 0
      ? await enrichOddsFromApiFootball(env, db, quotaPlan.oddsLimit, rateLimit)
      : { oddsSynced: 0, syncedMatchIds: [], queued: 0 };
    oddsSynced = oddsResult?.oddsSynced ?? oddsResult ?? 0;
    logosSynced = oddsResult?.logosSynced ?? 0;
    nameMiss = oddsResult?.nameMiss ?? 0;
    emptyOdds = oddsResult?.emptyOdds ?? 0;
    directHits = oddsResult?.directHits ?? 0;
    queued = oddsResult?.queued ?? 0;
    batchErrors = oddsResult?.batchErrors ?? 0;
    if (!oddsSynced && oddsResult?.lastBatchError) {
      afError = oddsResult.lastBatchError;
    } else if (!oddsSynced && queued > 0 && emptyOdds + nameMiss + directHits === 0 && batchErrors > 0) {
      afError = oddsResult.lastBatchError || `AF batches failed (${batchErrors})`;
    }
    const ids = oddsResult?.syncedMatchIds || [];
    if (ids.length) {
      const pred = await predictMany(db, ids.slice(0, ODDS_ENRICH_LIMIT));
      tipsRefreshed = pred.filter((r) => r && !r.error).length;
      try {
        await store.backfillTipOddsBands(db, Math.min(200, ids.length + 40));
      } catch (_) {
        /* tip odds backfill optional */
      }
    }
  } catch (err) {
    afError = err.message || String(err);
  }
  try {
    await store.setMeta(db, 'last_enrich_at', now);
    await store.setMeta(
      db,
      'last_enrich_summary',
      JSON.stringify({
        at: now,
        statsSynced,
        oddsSynced,
        logosSynced,
        tipsRefreshed,
        nameMiss,
        emptyOdds,
        directHits,
        queued,
        batchErrors,
        afProbe,
        quotaPlan,
        afError,
      })
    );
  } catch (_) {
    /* meta optional */
  }
  return {
    ok: !afError,
    mode: 'af-enrich',
    statsSynced,
    oddsSynced,
    logosSynced,
    tipsRefreshed,
    nameMiss,
    emptyOdds,
    directHits,
    queued,
    batchErrors,
    afProbe,
    quotaPlan,
    afError,
    lastEnrichAt: now,
  };
}

const LIVE_REFRESH_COOLDOWN_MS = 45 * 1000;

async function fetchEventsForMatchRow(env, m, hasAfKey, fotmobIdByMatchId = null) {
  const afId = m.af_fixture_id != null ? Number(m.af_fixture_id) : null;
  if (hasAfKey && afId) {
    try {
      const data = await apiGet(env, '/fixtures/events', { fixture: afId });
      const afEvents = normalizeAfEvents(
        data,
        m.home_team_api_id,
        m.away_team_api_id,
        m.home_name,
        m.away_name
      );
      if (afEvents.length) return afEvents;
    } catch {
      /* fall through to FotMob */
    }
  }
  // Stored id first (resolved by name on previous refreshes), then the ones
  // derived from our own api_id namespace, then the map of this refresh.
  let fmId = m.fotmob_match_id != null ? Number(m.fotmob_match_id) : null;
  if (!fmId) fmId = fotmobMatchIdFromApiId(m.api_id);
  if (!fmId && fotmobIdByMatchId) {
    fmId = fotmobIdByMatchId.get(Number(m.id)) || null;
  }
  if (fmId) {
    const details = await fetchFotmobMatchDetails(fmId);
    return normalizeFotmobEvents(details);
  }
  return [];
}

/**
 * Lightweight status refresh for today and yesterday.
 * The one-day lookback closes matches that crossed midnight without an active client.
 */
export async function runLiveStatusRefresh(env, db, { force = false } = {}) {
  const lastAt = await store.getMeta(db, 'last_live_refresh_at');
  const lastMs = lastAt ? Date.parse(lastAt) : NaN;
  if (!force && lastAt && !Number.isNaN(lastMs) && Date.now() - lastMs < LIVE_REFRESH_COOLDOWN_MS) {
    return {
      ok: true,
      skipped: true,
      reason: 'cooldown',
      lastLiveRefreshAt: lastAt,
      fdUpdated: 0,
      fotmobUpdated: 0,
      afUpdated: 0,
    };
  }

  let fdUpdated = 0;
  let fotmobUpdated = 0;
  let afUpdated = 0;
  const errors = [];
  const fotmobIdByMatchId = new Map();

  try {
    const { fixtures, errors: fdErrs } = await fetchTodayFixtures(-1, 0);
    errors.push(...(fdErrs || []));
    for (const fx of fixtures) {
      if (fx.status !== 'finished') continue;
      await store.updateMatchLiveByApiId(db, fx.api_id, {
        status: 'finished',
        home_goals: fx.homeGoals,
        away_goals: fx.awayGoals,
        elapsed_minute: null,
      });
      fdUpdated += 1;
    }
  } catch (err) {
    errors.push({ source: 'fixturedownload', error: err.message || String(err) });
  }

  try {
    const dbMatches = await store.getTodayMatchesForLiveRefresh(db);
    const { fixtures: liveSnap, all: allLive, errors: fmErrs } = await fetchFotmobLiveSnapshot(-1, 0, {
      includeAll: true,
    });
    errors.push(...(fmErrs || []).map((e) => ({ source: 'fotmob', ...e })));

    const updatedIds = new Set();
    const liveUpdates = [];
    for (const fx of liveSnap || []) {
      await store.updateMatchLiveByApiId(db, fx.api_id, {
        status: fx.status,
        home_goals: fx.homeGoals,
        away_goals: fx.awayGoals,
        elapsed_minute: fx.status === 'live' ? fx.elapsed_minute ?? null : null,
      });
      // Name-match onto FD / other rows (e.g. UNL) that don't share FotMob api_id
      const best = findBestFixtureMatch(
        dbMatches.map((m) => ({
          _row: m,
          teams: { home: { name: m.home_name }, away: { name: m.away_name } },
        })),
        fx.homeName,
        fx.awayName
      );
      const fmId = fotmobMatchIdFromApiId(fx.api_id);
      if (best?._row?.id && !updatedIds.has(best._row.id)) {
        liveUpdates.push({
          id: best._row.id,
          status: fx.status,
          home_goals: fx.homeGoals,
          away_goals: fx.awayGoals,
          elapsed_minute: fx.status === 'live' ? fx.elapsed_minute ?? null : null,
          fotmob_match_id: fmId ?? null,
        });
        updatedIds.add(best._row.id);
        if (fmId) fotmobIdByMatchId.set(Number(best._row.id), fmId);
        fotmobUpdated += 1;
      } else if (fx.api_id) {
        fotmobUpdated += 1;
      }
    }

    // Rows from other feeds (FixtureDownload domestic leagues) have no FotMob id.
    // Resolve one by name so the live score, the minute and the incidents arrive.
    const liveIndex = buildLiveNameIndex(allLive);
    for (const m of dbMatches) {
      if (updatedIds.has(m.id)) continue;
      const candidates = liveCandidatesFor(liveIndex, m.home_name, m.away_name);
      if (!candidates.length) continue;
      const best = findBestFixtureMatch(candidates, m.home_name, m.away_name);
      const fm = best?._fm;
      if (!fm) continue;
      liveUpdates.push({
        id: m.id,
        status: fm.status,
        home_goals: fm.homeGoals,
        away_goals: fm.awayGoals,
        elapsed_minute: fm.status === 'live' ? fm.elapsed ?? null : null,
        fotmob_match_id: fm.fotmobId,
      });
      updatedIds.add(m.id);
      fotmobIdByMatchId.set(Number(m.id), fm.fotmobId);
      fotmobUpdated += 1;
    }
    await store.updateMatchLiveBatch(db, liveUpdates);
  } catch (err) {
    errors.push({ source: 'fotmob', error: err.message || String(err) });
  }

  const hasKey = Boolean(env.API_FOOTBALL_KEY && String(env.API_FOOTBALL_KEY).trim());
  if (hasKey) {
    try {
      const dbMatches = await store.getTodayMatchesForLiveRefresh(db);
      const liveData = await apiGet(env, '/fixtures', { live: 'all' });
      const liveItems = liveData.response || [];
      const dayItems = [];
      for (const date of dateOffsets(-1, 0)) {
        const dayData = await apiGet(env, '/fixtures', { date });
        dayItems.push(...(dayData.response || []));
      }
      const allItems = [...liveItems, ...dayItems];
      const byLeague = new Map();
      for (const item of allItems) {
        const lid = Number(item.league?.id);
        if (!lid) continue;
        if (!byLeague.has(lid)) byLeague.set(lid, []);
        byLeague.get(lid).push(item);
      }

      for (const m of dbMatches) {
        const leagueApi = Number(m.league_api_id);
        // AF league ids for clubs match FD; FotMob leagues use 840M+ — skip those for AF name match on wrong pool
        let candidates = byLeague.get(leagueApi) || [];
        if (!candidates.length && leagueApi > 100000) {
          candidates = allItems;
        }
        const best = findBestFixtureMatch(candidates, m.home_name, m.away_name);
        if (!best) continue;
        const status = mapStatus(best.fixture?.status?.short);
        const elapsedRaw = best.fixture?.status?.elapsed;
        const elapsed =
          elapsedRaw != null && !Number.isNaN(Number(elapsedRaw)) ? Number(elapsedRaw) : null;
        const hg = best.goals?.home != null ? Number(best.goals.home) : null;
        const ag = best.goals?.away != null ? Number(best.goals.away) : null;
        if (status === 'scheduled' && hg == null) continue;
        const afFixId = best.fixture?.id != null ? Number(best.fixture.id) : null;
        await store.updateMatchLiveById(db, m.id, {
          status,
          home_goals: hg,
          away_goals: ag,
          elapsed_minute: status === 'live' ? elapsed : null,
        });
        if (afFixId && !m.af_fixture_id) {
          await store.setMatchAfFixtureId(db, m.id, afFixId);
          m.af_fixture_id = afFixId;
        } else if (afFixId) {
          m.af_fixture_id = afFixId;
        }
        afUpdated += 1;
      }
    } catch (err) {
      errors.push({ source: 'api-football', error: err.message || String(err) });
    }
  }

  // Incidents for live and newly-finished matches — capped for Worker CPU/API budget.
  // Finished rows are fetched only when events_json is empty, avoiding repeated detail calls.
  try {
    const eventRows = (await store.getTodayMatchesForLiveRefresh(db))
      .filter((m) => {
        if (m.status === 'live') return true;
        if (m.status !== 'finished') return false;
        const raw = String(m.events_json || '').trim();
        return !raw || raw === '[]';
      })
      // Running matches first: they are the ones whose timeline is still moving.
      .sort((a, b) => (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1));
    const eventWrites = [];
    for (const m of eventRows.slice(0, 14)) {
      try {
        const events = await fetchEventsForMatchRow(env, m, hasKey, fotmobIdByMatchId);
        if (events?.length) {
          eventWrites.push({ id: m.id, events });
        }
        if (m.status === 'finished') {
          const fmId =
            fotmobMatchIdFromApiId(m.api_id) ||
            (m.fotmob_match_id != null ? Number(m.fotmob_match_id) : null) ||
            fotmobIdByMatchId.get(Number(m.id)) ||
            null;
          if (fmId) {
            const details = await fetchFotmobMatchDetails(fmId);
            await persistFotmobStats(db, m, details);
          }
        }
      } catch (err) {
        errors.push({ source: 'events', matchId: m.id, error: err.message || String(err) });
      }
    }
    await store.updateMatchEventsBatch(db, eventWrites);
  } catch (err) {
    errors.push({ source: 'events', error: err.message || String(err) });
  }

  // Stats are independent from incidents: a match may already have events_json
  // while corners/cards/SOT are still missing.
  try {
    const statResult = await enrichStatsFromFotmob(db, 8, 60);
    errors.push(...(statResult.errors || []));
  } catch (err) {
    errors.push({ source: 'fotmob-stats', error: err.message || String(err) });
  }

  const now = new Date().toISOString();
  await store.setMeta(db, 'last_live_refresh_at', now);
  let tipsSettled = 0;
  let tipsBackfilled = 0;
  let calibrationUpdatedAt = null;
  let ratingsMaint = null;
  try {
    tipsBackfilled = await store.backfillPendingTips(db);
    await store.backfillTipOddsBands(db);
    tipsSettled = await store.settlePendingTips(db);
    if (tipsSettled > 0) {
      const calib = await fitTipCalibration(db);
      calibrationUpdatedAt = calib?.updatedAt || null;
    }
  } catch (err) {
    errors.push({ source: 'tip_settle', error: err.message || String(err) });
  }
  try {
    ratingsMaint = await maintainTeamRatings(db);
  } catch (err) {
    errors.push({ source: 'team_ratings', error: err.message || String(err) });
    ratingsMaint = { mode: 'skip' };
  }
  return {
    ok: true,
    skipped: false,
    fdUpdated,
    fotmobUpdated,
    afUpdated,
    afEnabled: hasKey,
    tipsBackfilled,
    tipsSettled,
    calibrationUpdatedAt,
    ratingsMaint,
    errors,
    lastLiveRefreshAt: now,
  };
}
