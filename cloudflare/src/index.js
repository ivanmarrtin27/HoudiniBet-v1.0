import { createDb } from './db.js';
import * as store from './db.js';
import { getPredictionBundle, predictMany } from './services/predictionService.js';
import {
  runDailySync,
  runAfEnrichOnly,
  handleLiveRefreshRequest,
  ensureMatchEventsFresh,
  runLiveCron,
  runLiveCronSafe,
} from './services/syncService.js';
import { WINDOW_DAYS } from './services/fixtureDownload.js';
import { resolveTeamLogoUrl } from './services/teamLogos.js';
import {
  resolveTipOdds,
  modelProbForBet,
  parseOddsBandParam,
  pickLegForCombo,
  BAND_META,
} from './services/oddsBands.js';
import { buildCombos, buildCombosForTargetOdds, comboOptsForBand } from './services/combos.js';
import {
  isTop5League,
  pickWeeklyLeg,
  pickWeeklyCandidates,
  buildWeeklyCombos,
  buildWeeklyProfiles,
  filterWeeklyLegs,
  parseWeeklyFilterParams,
  WEEKLY_DEFAULTS,
} from './services/weeklyComboService.js';
import { loadTipCalibration, fitTipCalibration } from './services/calibration.js';
import { runBacktestSuite } from './services/backtestService.js';
import { backfillRatings } from './services/ratingsService.js';
import { buildLiveBlock } from './services/liveModel.js';
import * as premiumService from './services/premiumService.js';
import * as authService from './services/authService.js';
import * as cfUsageService from './services/cfUsageService.js';
import * as pageHitsService from './services/pageHitsService.js';

/** Failed admin secret attempts (isolate memory). */
const adminSecretFails = new Map();
const ADMIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_FAIL_MAX = 30;

function checkAdminSecret(request, env) {
  const secret = env.SYNC_SECRET || 'change-me-houdini';
  const header = request.headers.get('x-sync-secret');
  const ip = clientIp(request);
  const now = Date.now();
  let entry = adminSecretFails.get(ip);
  if (entry && now - entry.start > ADMIN_FAIL_WINDOW_MS) {
    adminSecretFails.delete(ip);
    entry = null;
  }
  if (entry && entry.count > ADMIN_FAIL_MAX) {
    return { ok: false, status: 429, error: 'Demasiados intentos. Prueba más tarde.' };
  }
  if (!header || header !== secret) {
    if (!entry) entry = { start: now, count: 0 };
    entry.count += 1;
    adminSecretFails.set(ip, entry);
    return { ok: false, status: 401, error: 'No autorizado. Header x-sync-secret requerido.' };
  }
  return { ok: true };
}

const STALE_MS = 12 * 60 * 60 * 1000;
const SYNC_LOCK_MS = 5 * 60 * 1000;
/** Live refresh cron: every 10 minutes from late morning (covers early PL) through evening UTC. */
const LIVE_CRON = '*/10 11-23 * * *';

/** Anti-trivial tips still stored from older pickBets — refresh on list. */
const STALE_TRIVIAL_TIPS = new Set(['OVER_05', 'UNDER_45']);

function isStaleTipLabel(label) {
  const lab = String(label || '');
  return STALE_TRIVIAL_TIPS.has(lab) || lab.startsWith('SHOTS_');
}

/** Missing preds + stale trivial/SHOTS tips on list GETs — cap 5. Full recompute in sync/cron. */
function missingPredictionIds(allIds, existingMap, cap = 5) {
  const missing = [];
  const stale = [];
  for (const id of allIds) {
    const pred = existingMap.get(id);
    if (!pred) missing.push(id);
    else if (
      isStaleTipLabel(pred.suggested_bet) ||
      isStaleTipLabel(pred.secondary_bet)
    ) {
      stale.push(id);
    }
  }
  const out = [];
  for (const id of missing) {
    if (out.length >= cap) break;
    out.push(id);
  }
  for (const id of stale) {
    if (out.length >= cap) break;
    out.push(id);
  }
  return out;
}

function tipTierFromStored(suggestedBet, confidenceScore, tipOdds, storedTier = null) {
  if (!suggestedBet) return null;
  const tier = storedTier != null ? String(storedTier).trim() : '';
  if (tier === 'playable') return 'playable';
  if (tier === 'none') return 'none';
  if (tier === 'fallback') return 'fallback';
  if (STALE_TRIVIAL_TIPS.has(String(suggestedBet))) return 'fallback';
  const conf = confidenceScore != null ? Number(confidenceScore) : null;
  const odds = tipOdds != null ? Number(tipOdds) : null;
  if (odds != null && Number.isFinite(odds) && odds < 1.25) return 'fallback';
  // Legacy rows (pre tip_tier): conf 0 = display-only; conf ≥67 ≈ playable.
  if (conf != null && conf > 0 && conf >= 67) return 'playable';
  if (conf != null && conf === 0) return 'none';
  return 'fallback';
}

function json(data, status = 200, extraHeaders = null) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-sync-secret',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (k.toLowerCase() === 'set-cookie') {
        const list = Array.isArray(v) ? v : [v];
        for (const c of list) {
          if (c) headers.append('set-cookie', c);
        }
      } else if (v != null) {
        headers.set(k, String(v));
      }
    }
  }
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** Resolve premium from hb_prem cookie and/or linked auth user. */
async function premiumSessionOf(request, db, userId = null) {
  const cookieValue = premiumService.sessionCookieFromHeader(request.headers.get('cookie'));
  let fromCookie = { premium: false, session: null };
  if (cookieValue) {
    fromCookie = await premiumService.resolvePremiumSession(db, cookieValue);
  }
  let uid = userId;
  if (!uid) {
    const authCookie = authService.authCookieFromHeader(request.headers.get('cookie'));
    const { user } = await authService.resolveAuthSession(db, authCookie);
    uid = user?.id || null;
  }
  if (uid && cookieValue && fromCookie.session) {
    await premiumService.attachPremiumSessionToUser(db, cookieValue, uid).catch(() => {});
  }
  if (fromCookie.premium) return fromCookie;
  if (uid) {
    const row = await premiumService.findPremiumForUser(db, uid);
    if (row && premiumService.isPremiumActive(row)) {
      return { premium: true, session: row };
    }
  }
  return fromCookie.session ? fromCookie : { premium: false, session: null };
}

async function authUserOf(request, db) {
  const cookieValue = authService.authCookieFromHeader(request.headers.get('cookie'));
  const { user } = await authService.resolveAuthSession(db, cookieValue);
  return user || null;
}

function premiumRequiredResponse() {
  return json(
    {
      error: 'Premium requerido: esta vista pertenece al plan de pago.',
      errorCode: 'premium_required',
      premium: false,
    },
    402
  );
}

function parseDays(url, fallback = WINDOW_DAYS) {  const daysParam = url.searchParams.get('days');
  if (daysParam == null) return fallback;
  return Math.max(0, Number(daysParam) || 0);
}

/** @returns {{ mode: 'date'|'all'|'days', date: string|null, days: number }} */
function parseMatchWindow(url) {
  const all = url.searchParams.get('all');
  if (all === '1' || all === 'true') {
    return { mode: 'all', date: null, days: WINDOW_DAYS };
  }
  const date = (url.searchParams.get('date') || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { mode: 'date', date, days: 0 };
  }
  if (url.searchParams.has('days')) {
    return { mode: 'days', date: null, days: parseDays(url, 0) };
  }
  // Default: today
  return { mode: 'date', date: new Date().toISOString().slice(0, 10), days: 0 };
}

/**
 * If last sync is missing or older than 12h, kick off background sync.
 */
async function maybeAutoSync(env, db, ctx) {
  const lastSyncAt = await store.getMeta(db, 'last_sync_at');
  const syncStartedAt = await store.getMeta(db, 'sync_started_at');
  const now = Date.now();

  if (syncStartedAt) {
    const startedMs = Date.parse(syncStartedAt);
    if (!Number.isNaN(startedMs) && now - startedMs < SYNC_LOCK_MS) {
      return { syncing: true, lastSyncAt, stale: true };
    }
  }

  const lastMs = lastSyncAt ? Date.parse(lastSyncAt) : NaN;
  const stale = !lastSyncAt || Number.isNaN(lastMs) || now - lastMs >= STALE_MS;
  if (!stale) {
    return { syncing: false, lastSyncAt, stale: false };
  }

  await store.setMeta(db, 'sync_started_at', new Date().toISOString());
  ctx.waitUntil(
    runDailySync(env, db)
      .then((r) => console.log('auto sync', JSON.stringify(r)))
      .catch(async (err) => {
        console.error('auto sync fail', err);
        try {
          await store.setMeta(db, 'sync_started_at', '');
        } catch (_) {
          /* ignore */
        }
      })
  );
  return { syncing: true, lastSyncAt, stale: true };
}

function tipOddsMeta(suggestedBet, predictionRow, oddsRow) {
  return resolveTipOdds(suggestedBet, predictionRow, oddsRow);
}

/** Convert model prob (0–1 or already %) to display 0–100. */
function toMarketPct(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Number(pct.toFixed(1));
}

function marketsFromPrediction(p) {
  if (!p) return null;
  return {
    home: toMarketPct(p.home_win_prob ?? p.homeWinProb),
    draw: toMarketPct(p.draw_prob ?? p.drawProb),
    away: toMarketPct(p.away_win_prob ?? p.awayWinProb),
    over25: toMarketPct(p.over25_prob ?? p.over25Prob),
    under25: toMarketPct(p.under25_prob ?? p.under25Prob),
    bttsYes: toMarketPct(p.btts_yes_prob ?? p.bttsYesProb),
    bttsNo: toMarketPct(p.btts_no_prob ?? p.bttsNoProb),
  };
}

function mapBetPayload(r) {
  const oddsMeta = tipOddsMeta(r.suggested_bet, r, r);
  const secBet = r.secondary_bet || null;
  const secMeta = secBet
    ? tipOddsMeta(secBet, r, r)
    : { tipOdds: null, oddsBand: null, oddsSource: null };
  const secProb = secBet ? modelProbForBet(r, secBet) : null;
  const secConf =
    secProb != null && Number.isFinite(secProb)
      ? Number((secProb * 100).toFixed(2))
      : null;
  const tipTier = tipTierFromStored(
    r.suggested_bet,
    r.confidence_score,
    oddsMeta.tipOdds,
    r.tip_tier
  );
  return {
    matchId: r.match_id,
    matchDate: r.match_date,
    leagueId: r.league_id != null ? Number(r.league_id) : null,
    league: r.league_name,
    leagueCountry: r.league_country || null,
    homeTeam: { name: r.home_name, logo: resolveTeamLogoUrl(r.home_name, r.home_logo) },
    awayTeam: { name: r.away_name, logo: resolveTeamLogoUrl(r.away_name, r.away_logo) },
    suggestedBet: r.suggested_bet,
    secondaryBet: secBet,
    confidenceScore: Number(r.confidence_score),
    highConfidence: Number(r.confidence_score) >= 60,
    tipTier,
    valueEdge: r.value_edge != null ? Number(r.value_edge) : null,
    valueMarket: r.value_market,
    tipOdds: oddsMeta.tipOdds,
    oddsBand: oddsMeta.oddsBand,
    oddsSource: oddsMeta.oddsSource,
    secondaryTipOdds: secMeta.tipOdds,
    secondaryOddsSource: secMeta.oddsSource,
    secondaryConfidence: secConf,
    markets: marketsFromPrediction(r),
    homeWinProb: r.home_win_prob != null ? Number(r.home_win_prob) : null,
    drawProb: r.draw_prob != null ? Number(r.draw_prob) : null,
    awayWinProb: r.away_win_prob != null ? Number(r.away_win_prob) : null,
    over15Prob: r.over15_prob != null ? Number(r.over15_prob) : null,
    under15Prob: r.under15_prob != null ? Number(r.under15_prob) : null,
    over25Prob: r.over25_prob != null ? Number(r.over25_prob) : null,
    under25Prob: r.under25_prob != null ? Number(r.under25_prob) : null,
    over35Prob: r.over35_prob != null ? Number(r.over35_prob) : null,
    under35Prob: r.under35_prob != null ? Number(r.under35_prob) : null,
    bttsYesProb: r.btts_yes_prob != null ? Number(r.btts_yes_prob) : null,
    bttsNoProb: r.btts_no_prob != null ? Number(r.btts_no_prob) : null,
    cornersOver95Prob: r.corners_over95_prob != null ? Number(r.corners_over95_prob) : null,
    cornersUnder95Prob: r.corners_under95_prob != null ? Number(r.corners_under95_prob) : null,
    cardsOver35Prob: r.cards_over35_prob != null ? Number(r.cards_over35_prob) : null,
    cardsUnder35Prob: r.cards_under35_prob != null ? Number(r.cards_under35_prob) : null,
    cardsOver45Prob: r.cards_over45_prob != null ? Number(r.cards_over45_prob) : null,
    cardsUnder45Prob: r.cards_under45_prob != null ? Number(r.cards_under45_prob) : null,
  };
}

async function handleApi(request, env, ctx) {
  const db = createDb(env.DB);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') {
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/api/v1/status') {
    const auto = await maybeAutoSync(env, db, ctx);
    const hasKey = Boolean(env.API_FOOTBALL_KEY && String(env.API_FOOTBALL_KEY).trim());
    const fdCount = await store.countFixtureDownloadMatches(db, WINDOW_DAYS);
    const oddsCount = await store.countOddsRows(db);
    const cornersCount = await store.countStatsWithCorners(db);
    const yellowsCount = await store.countStatsWithYellows(db);
    const shotsOnTargetCount = await store.countStatsWithShotsOnTarget(db);
    const upcoming = await store.countUpcomingInWindow(db, WINDOW_DAYS);
    const upcomingWithOdds = await store.countUpcomingWithOdds(db, WINDOW_DAYS);
    const oddsCoveragePct =
      upcoming > 0 ? Number(((100 * upcomingWithOdds) / upcoming).toFixed(1)) : null;
    const lastEnrichAt = await store.getMeta(db, 'last_enrich_at');
    const lastLiveRefreshAt = await store.getMeta(db, 'last_live_refresh_at');
    const lastLiveCronAt = await store.getMeta(db, 'last_live_cron_at');
    let liveWork = null;
    try {
      liveWork = await store.getLiveWorkStatus(db);
    } catch (_) {
      liveWork = null;
    }
    let lastEnrichSummary = null;
    try {
      const rawSum = await store.getMeta(db, 'last_enrich_summary');
      lastEnrichSummary = rawSum ? JSON.parse(rawSum) : null;
    } catch (_) {
      lastEnrichSummary = null;
    }
    let calibDecided = null;
    try {
      const calib = await loadTipCalibration(db);
      calibDecided = calib?.decided ?? null;
    } catch (_) {
      calibDecided = null;
    }
    let mode = 'demo';
    let message =
      'Modo demo (seed). Auto-sync o Sync manual trae calendario real (FixtureDownload).';
    let top5Upcoming = 0;
    let top5WithOdds = 0;
    let top5OddsCoveragePct = null;
    try {
      top5Upcoming = await store.countUpcomingTop5(db, WINDOW_DAYS);
      top5WithOdds = await store.countUpcomingTop5WithOdds(db, WINDOW_DAYS);
      top5OddsCoveragePct =
        top5Upcoming > 0
          ? Number(((100 * top5WithOdds) / top5Upcoming).toFixed(1))
          : null;
    } catch (_) {
      top5Upcoming = 0;
      top5WithOdds = 0;
    }
    if (fdCount > 0) {
      mode = 'live';
      message = hasKey
        ? `FD + API-Football: ${upcomingWithOdds}/${upcoming} con cuota (${oddsCoveragePct ?? 0}%) · top5 ${top5WithOdds}/${top5Upcoming} (${top5OddsCoveragePct ?? 0}%) · corners=${cornersCount} · amarillas=${yellowsCount}.`
        : `Calendario FD (${fdCount} partidos). Sin API_FOOTBALL_KEY → sin value ni cuotas book. Corners/amarillas vía FotMob cuando hay muestra.`;
    } else if (auto.syncing) {
      message = 'Sincronizando calendario real en segundo plano… recarga en unos segundos.';
    }
    return json({
      ok: true,
      date: new Date().toISOString().slice(0, 10),
      mode,
      demo: mode === 'demo',
      source: fdCount > 0 ? 'fixturedownload' : 'seed',
      oddsEnabled: hasKey,
      apiFootballKeyPresent: hasKey,
      oddsMatchCount: oddsCount,
      cornersMatchCount: cornersCount,
      yellowsMatchCount: yellowsCount,
      shotsOnTargetMatchCount: shotsOnTargetCount,
      upcomingCount: upcoming,
      upcomingWithOdds,
      oddsCoveragePct,
      top5UpcomingCount: top5Upcoming,
      top5WithOdds,
      top5OddsCoveragePct,
      fixtureDownloadCount: fdCount,
      windowDays: WINDOW_DAYS,
      lastSyncAt: auto.lastSyncAt,
      lastEnrichAt: lastEnrichAt || null,
      lastLiveRefreshAt: lastLiveRefreshAt || null,
      lastLiveCronAt: lastLiveCronAt || null,
      liveWork,
      lastEnrichSummary,
      calibrationDecided: calibDecided,
      syncing: auto.syncing,
      leagues: env.LEAGUE_IDS || '',
      message,
    });
  }

  if (method === 'GET' && path === '/api/v1/matches/today') {
    await maybeAutoSync(env, db, ctx);
    const leagueId = url.searchParams.get('leagueId');
    const win = parseMatchWindow(url);
    const lid = leagueId ? Number(leagueId) : null;
    const matches =
      win.mode === 'date'
        ? await store.getByDate(db, win.date, lid)
        : await store.getUpcoming(db, win.days, lid);
    const allIds = matches.map((m) => m.id);
    const existing = await store.getPredictionsByMatchIds(db, allIds);
    const missing = missingPredictionIds(allIds, existing, 8);
    if (missing.length) await predictMany(db, missing);
    const predMap = await store.getPredictionsByMatchIds(db, allIds);
    const oddsMap = await store.getOddsByMatchIds(db, allIds);
    const enriched = matches.map((m) => {
      const p = predMap.get(m.id);
      const odds = oddsMap.get(m.id);
      const oddsMeta = tipOddsMeta(p?.suggested_bet, p, odds);
      const conf =
        p?.confidence_score != null ? Number(p.confidence_score) : null;
      const secBet = p?.secondary_bet ?? null;
      const secMeta = secBet
        ? tipOddsMeta(secBet, p, odds)
        : { tipOdds: null, oddsBand: null, oddsSource: null };
      const secProb = secBet ? modelProbForBet(p, secBet) : null;
      const secConf =
        secProb != null && Number.isFinite(secProb)
          ? Number((secProb * 100).toFixed(2))
          : null;
      return {
        ...m,
        suggestedBet: p?.suggested_bet ?? null,
        secondaryBet: secBet,
        confidenceScore: conf,
        valueEdge: p?.value_edge != null ? Number(p.value_edge) : null,
        valueMarket: p?.value_market ?? null,
        tipOdds: oddsMeta.tipOdds,
        oddsBand: oddsMeta.oddsBand,
        oddsSource: oddsMeta.oddsSource,
        tipTier: tipTierFromStored(p?.suggested_bet, conf, oddsMeta.tipOdds, p?.tip_tier),
        secondaryTipOdds: secMeta.tipOdds,
        secondaryOddsSource: secMeta.oddsSource,
        secondaryConfidence: secConf,
        markets: marketsFromPrediction(p),
        live: buildLiveBlock(m, p),
      };
    });
    const hasKey = Boolean(env.API_FOOTBALL_KEY && String(env.API_FOOTBALL_KEY).trim());
    const fdCount = await store.countFixtureDownloadMatches(db, WINDOW_DAYS);
    const mode = hasKey || fdCount > 0 ? 'live' : 'demo';
    return json({
      date: win.date || new Date().toISOString().slice(0, 10),
      windowMode: win.mode,
      windowDays: win.mode === 'all' || win.mode === 'days' ? win.days : 0,
      mode,
      count: enriched.length,
      matches: enriched,
    });
  }

  if (method === 'GET' && path === '/api/v1/combos/weekly') {
    const filters = parseWeeklyFilterParams(url.searchParams);
    const {
      leagueApiId: filterLeague,
      family: filterFamily,
      window: filterWindow,
      from: filterFrom,
      to: filterTo,
      fetchDays,
    } = filters;
    const days = Math.min(14, Math.max(3, Number(fetchDays) || 14));
    const ids = await store.getScheduledUpcomingIds(db, days);
    const fetchIds = ids.slice(0, 160);
    const existing = await store.getPredictionsByMatchIds(db, fetchIds);
    const missing = missingPredictionIds(fetchIds, existing, 8);
    if (missing.length) await predictMany(db, missing);
    const predMap = await store.getPredictionsByMatchIds(db, fetchIds);
    const matchRows = await store.getUpcoming(db, days, null);
    const oddsMap = await store.getOddsByMatchIds(db, fetchIds);
    const legsRaw = [];
    for (const m of matchRows) {
      if (!fetchIds.includes(m.id)) continue;
      if (!isTop5League(m)) continue;
      if (m.status !== 'scheduled') continue;
      const p = predMap.get(m.id);
      const odds = oddsMap.get(m.id) || null;
      const cands = pickWeeklyCandidates(m, p, odds);
      if (cands.length) legsRaw.push(...cands);
      else {
        const leg = pickWeeklyLeg(m, p, odds);
        if (leg) legsRaw.push(leg);
      }
    }
    const filtersActive =
      filterLeague != null || filterFamily != null || filterWindow !== 'next14';
    const legs = filterWeeklyLegs(legsRaw, {
      leagueApiId: filterLeague,
      family: filterFamily,
      from: filterFrom,
      to: filterTo,
    });
    const { aggressive, conservative } = buildWeeklyProfiles(legs);
    const excludeRaw = String(url.searchParams.get('excludeIds') || '');
    const excludeIds = new Set(
      excludeRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const aggressivePool = (aggressive.combos || []).filter(
      (c) => !c?.id || !excludeIds.has(String(c.id))
    );
    const primary = aggressivePool[0] || null;
    const conservativeCombo = conservative.combos[0] || null;
    const alternatives = aggressivePool.slice(1, 6);
    const uniqueMatches = new Set(legs.map((l) => l.matchId)).size;
    const uniqueRaw = new Set(legsRaw.map((l) => l.matchId)).size;
    let emptyReason = null;
    if (uniqueMatches < WEEKLY_DEFAULTS.MIN_LEGS) {
      emptyReason =
        filtersActive && uniqueRaw >= WEEKLY_DEFAULTS.MIN_LEGS
          ? 'no_legs_filtered'
          : 'no_legs';
    } else if (!primary && !conservativeCombo) {
      emptyReason = excludeIds.size
        ? 'no_more_after_exclude'
        : 'no_match_in_tolerance';
    }
    return json({
      windowDays: days,
      count: aggressivePool.length,
      emptyReason,
      meta: {
        ...aggressive.meta,
        activeFilters: {
          leagueApiId: filterLeague,
          family: filterFamily,
          window: filterWindow,
          from: filterFrom,
          to: filterTo,
        },
        poolSizeRaw: legsRaw.length,
        poolSizeFiltered: legs.length,
        excludedCount: excludeIds.size,
        conservative: {
          belowTarget: conservative.meta.belowTarget || false,
          belowReason: conservative.meta.belowReason || null,
          minJointProbAdj: WEEKLY_DEFAULTS.SAFE_MIN_JOINT,
          targetOdds: WEEKLY_DEFAULTS.SAFE_TARGET_ODDS,
        },
      },
      whyPreferred: aggressive.whyPreferred || null,
      primary,
      conservative: conservativeCombo,
      alternatives,
      combos: aggressivePool,
      generatedAt: new Date().toISOString(),
    });
  }

  if (method === 'GET' && path === '/api/v1/combos/by-target') {
    const win = parseMatchWindow(url);
    const targetOdds = Math.min(
      15,
      Math.max(1.8, Number(url.searchParams.get('targetOdds')) || 3)
    );
    const tolerance = Math.min(
      0.25,
      Math.max(0.05, Number(url.searchParams.get('tolerance')) || 0.12)
    );
    const limit = Math.min(12, Math.max(1, Number(url.searchParams.get('limit')) || 12));
    const ids =
      win.mode === 'date'
        ? await store.getScheduledIdsOnDate(db, win.date)
        : await store.getScheduledUpcomingIds(db, win.days);
    const fetchIds = ids.slice(0, 120);
    const existing = await store.getPredictionsByMatchIds(db, fetchIds);
    const missing = missingPredictionIds(fetchIds, existing, 5);
    if (missing.length) await predictMany(db, missing);
    const leagueIdsRaw = (url.searchParams.get('leagueIds') || '').trim();
    const leagueIdSet = new Set(
      leagueIdsRaw
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    );
    const predMap = await store.getPredictionsByMatchIds(db, fetchIds);
    const matchRows =
      win.mode === 'date'
        ? await store.getByDate(db, win.date, null)
        : await store.getUpcoming(db, win.days, null);
    const oddsMap = await store.getOddsByMatchIds(db, fetchIds);
    const calib = await loadTipCalibration(db);

    function collectLegs(bookOnly) {
      const out = [];
      for (const m of matchRows) {
        if (!fetchIds.includes(m.id)) continue;
        if (leagueIdSet.size && !leagueIdSet.has(Number(m.leagueId))) continue;
        const p = predMap.get(m.id);
        if (!p) continue;
        const odds = oddsMap.get(m.id) || null;
        const picked = pickLegForCombo(p, odds || p, [p.suggested_bet, p.secondary_bet], {
          tipMin: 1.2,
          tipMax: 2.8,
          calib,
          bookOnly,
        });
        if (!picked) continue;
        if (bookOnly && picked.oddsSource !== 'book') continue;
        out.push({
          matchId: m.id,
          matchDate: m.matchDate,
          league: m.leagueName,
          leagueId: m.leagueId,
          leagueCountry: m.leagueCountry,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          suggestedBet: picked.label,
          tipOdds: picked.tipOdds,
          oddsSource: picked.oddsSource || (bookOnly ? 'book' : 'model'),
          confidenceScore: Number((picked.prob * 100).toFixed(2)),
          prob: picked.prob,
        });
      }
      return out;
    }

    // Prefer book legs; if fewer than 3, fall back to model-implied tips (labeled).
    let legs = collectLegs(true);
    let pricingMode = 'book';
    if (legs.length < 3) {
      legs = collectLegs(false);
      pricingMode = 'model';
    }

    const built = buildCombosForTargetOdds(legs, targetOdds, {
      tolerance,
      limit,
      minLegs: 3,
      maxLegs: 8,
      poolSize: 14,
      tipMin: 1.2,
      tipMax: 2.8,
    });
    const combos = built.map((c, i) => {
      const comboPricing = c.pricing || pricingMode;
      return {
        id: `t${targetOdds.toFixed(1)}-${i}-${c.legs.map((l) => l.matchId).join('_')}`,
        combinedOdds: c.combinedOdds,
        targetOdds: c.targetOdds,
        avgConfidence: c.avgConfidence,
        jointProb: c.jointProb,
        nLegs: c.nLegs ?? c.legs.length,
        pricing: comboPricing,
        oddsSource: comboPricing === 'book' ? 'book' : comboPricing,
        legs: c.legs,
      };
    });
    const responsePricing =
      combos.length === 0
        ? pricingMode
        : combos.every((c) => c.pricing === 'book')
          ? 'book'
          : combos.every((c) => c.pricing === 'model')
            ? 'model'
            : 'mixed';
    return json({
      date: win.date || null,
      windowMode: win.mode,
      windowDays: win.mode === 'all' || win.mode === 'days' ? win.days : 0,
      targetOdds: Number(targetOdds.toFixed(2)),
      tolerance,
      minLegs: 3,
      maxLegs: 8,
      poolSize: legs.length,
      pricing: responsePricing,
      count: combos.length,
      emptyReason:
        legs.length === 0
          ? 'no_legs'
          : combos.length === 0
            ? 'no_match_in_tolerance'
            : null,
      note:
        responsePricing === 'book'
          ? 'P(acierto) ≈ producto de P_modelo (independencia). Cuotas de casa.'
          : 'P(acierto) ≈ producto de P_modelo (independencia). Cuotas estimadas (sin book) — no son precios de casa.',
      combos,
    });
  }

  if (method === 'GET' && path === '/api/v1/matches/best-bets') {
    const win = parseMatchWindow(url);
    const oddsBand = parseOddsBandParam(url.searchParams.get('oddsBand'));
    // Combos by odds band are public (no login / premium gate yet).
    const limitParam = url.searchParams.get('limit');
    const defaultLimit = oddsBand ? 25 : 200;
    const limit = Math.min(400, Math.max(1, Number(limitParam) || defaultLimit));
    const ids =
      win.mode === 'date'
        ? await store.getScheduledIdsOnDate(db, win.date)
        : await store.getScheduledUpcomingIds(db, win.days);
    const fetchLimit = oddsBand
      ? Math.min(400, Math.max(ids.length || 80, 80))
      : Math.min(400, Math.max(limit, ids.length || limit));
    const existing = await store.getPredictionsByMatchIds(db, ids);
    const missing = missingPredictionIds(ids, existing, 8);
    if (missing.length) await predictMany(db, missing);
    const rows =
      win.mode === 'date'
        ? await store.getBestBetsOnDate(db, win.date, fetchLimit)
        : await store.getBestBets(db, fetchLimit, win.days);
    let bets = rows.map(mapBetPayload);
    if (oddsBand) {
      // Pool = partidos de la ventana; opcionalmente filtrados por leagueIds (multi)
      const leagueIdsRaw = (url.searchParams.get('leagueIds') || '').trim();
      const leagueIdSet = new Set(
        leagueIdsRaw
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      );
      const predMap = await store.getPredictionsByMatchIds(db, ids);
      const matchRows =
        win.mode === 'date'
          ? await store.getByDate(db, win.date, null)
          : await store.getUpcoming(db, win.days, null);
      const oddsMap = await store.getOddsByMatchIds(db, ids);
      const bandOpts = comboOptsForBand(oddsBand);
      const calib = await loadTipCalibration(db);
      const legs = [];
      for (const m of matchRows) {
        if (leagueIdSet.size && !leagueIdSet.has(Number(m.leagueId))) continue;
        const p = predMap.get(m.id);
        if (!p) continue;
        const odds = oddsMap.get(m.id) || null;
        const picked = pickLegForCombo(p, odds || p, [p.suggested_bet, p.secondary_bet], {
          tipMin: bandOpts.tipMin,
          tipMax: bandOpts.tipMax,
          calib,
        });
        if (!picked) continue;
        legs.push({
          matchId: m.id,
          matchDate: m.matchDate,
          league: m.leagueName,
          leagueId: m.leagueId,
          leagueCountry: m.leagueCountry,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          suggestedBet: picked.label,
          tipOdds: picked.tipOdds,
          oddsSource: picked.oddsSource,
          confidenceScore: Number((picked.prob * 100).toFixed(2)),
        });
      }
      const built = buildCombos(legs, oddsBand, {
        ...bandOpts,
        limit: Math.min(8, limit),
      });
      const combos = built.map((c, i) => ({
        id: `${oddsBand}-${i}-${c.legs.map((l) => l.matchId).join('_')}`,
        combinedOdds: c.combinedOdds,
        oddsBand: c.oddsBand,
        avgConfidence: c.avgConfidence,
        // Only a fully book-priced combo counts towards profitability.
        oddsSource: c.legs.every((l) => l.oddsSource === 'book') ? 'book' : 'model',
        legs: c.legs,
      }));
      try {
        await store.upsertComboResults(db, combos);
        await store.settlePendingCombos(db, 20);
      } catch (_) {
        /* ledger optional for response */
      }
      return json({
        date: win.date || null,
        windowMode: win.mode,
        windowDays: win.mode === 'all' || win.mode === 'days' ? win.days : 0,
        oddsBand,
        bandMeta: BAND_META[oddsBand] || null,
        leagueIds: leagueIdSet.size ? [...leagueIdSet] : null,
        count: combos.length,
        combos,
        bets: [],
      });
    }
    // Defense: Mejores / best-bets stay playable-only (Stats tip_results lane).
    // Top 10 UI builds client-side from /matches/today?date= (selected day) with soft backfill — not this list.
    bets = bets
      .filter((b) => !b.tipTier || b.tipTier === 'playable')
      .slice(0, limit);
    return json({
      date: win.date || null,
      windowMode: win.mode,
      windowDays: win.mode === 'all' || win.mode === 'days' ? win.days : 0,
      oddsBand: null,
      bandMeta: null,
      count: bets.length,
      bets,
      combos: null,
    });
  }

  if (method === 'GET' && path === '/api/v1/tips/summary') {
    const win = parseMatchWindow(url);
    const summary = await store.getTipSummary(db, win);
    return json({
      hits: summary.hits,
      misses: summary.misses,
      pending: summary.pending,
      voids: summary.voids,
      decided: summary.decided,
      hitRate: summary.hitRate,
      windowLabel: summary.windowLabel || null,
      windowMode: win.mode,
      windowDays: win.mode === 'all' || win.mode === 'days' ? win.days : 0,
    });
  }

  if (method === 'GET' && path === '/api/v1/tips/performance') {
    const win = parseMatchWindow(url);
    const recentLimit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const recentOffset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const perf = await store.getTipPerformance(db, win, {
      limit: recentLimit,
      offset: recentOffset,
    });
    let calib = await loadTipCalibration(db);
    if (!calib) {
      try {
        // Fast bootstrap (tips only); full mid-band fit runs on daily sync.
        calib = await fitTipCalibration(db, 90, { includeMidBands: false });
      } catch (_) {
        calib = null;
      }
    }
    const payload = {
      hits: perf.hits,
      misses: perf.misses,
      pending: perf.pending,
      voids: perf.voids,
      decided: perf.decided,
      hitRate: perf.hitRate,
      windowLabel: perf.windowLabel || null,
      windowMode: win.mode,
      windowDays: win.mode === 'all' || win.mode === 'days' ? win.days : 0,
      byFamily: perf.byFamily,
      byOddsBand: perf.byOddsBand,
      roi: perf.roi || null,
      roiByFamily: perf.roiByFamily || {},
      calibration: calib
        ? {
            updatedAt: calib.updatedAt || null,
            sampleDays: calib.sampleDays || null,
            decided: calib.decided ?? null,
          }
        : null,
      recentCombos: perf.recentCombos || [],
      recentOffset: perf.recentOffset ?? recentOffset,
      recentLimit: perf.recentLimit ?? recentLimit,
      recentHasMore: Boolean(perf.recentHasMore),
      recent: (perf.recent || []).map((r) => ({
        matchId: r.match_id != null ? Number(r.match_id) : null,
        suggestedBet: r.suggested_bet,
        confidenceScore: r.confidence_score != null ? Number(r.confidence_score) : null,
        tipOdds: r.tip_odds != null ? Number(r.tip_odds) : null,
        oddsBand: r.odds_band || null,
        oddsSource: r.odds_source || null,
        outcome: r.outcome,
        homeGoals: r.home_goals,
        awayGoals: r.away_goals,
        settledAt: r.settled_at,
        matchDate: r.match_date,
        homeName: r.home_name,
        awayName: r.away_name,
        homeLogo: resolveTeamLogoUrl(r.home_name, r.home_logo),
        awayLogo: resolveTeamLogoUrl(r.away_name, r.away_logo),
        leagueName: r.league_name,
        leagueCountry: r.league_country || null,
      })),
    };
    // Full performance (ROI + recent tips) is public until login/premium ships.
    return json(payload);
  }
  // —— Auth (email + Google) ——
  if (method === 'POST' && path === '/api/v1/auth/register') {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      return json({ error: 'JSON inválido' }, 400);
    }
    const userV = authService.validateUsername(body.username);
    if (!userV.ok) return json({ error: userV.error }, 400);
    const nameV = authService.validateName(body.name);
    if (!nameV.ok) return json({ error: nameV.error }, 400);
    const phoneV = authService.validatePhone(body.phone, { required: true });
    if (!phoneV.ok) return json({ error: phoneV.error }, 400);
    const emailV = authService.validateEmail(body.email);
    if (!emailV.ok) return json({ error: emailV.error }, 400);
    const passV = authService.validatePassword(body.password);
    if (!passV.ok) return json({ error: passV.error }, 400);
    const confirm = body.password2 ?? body.passwordConfirm;
    if (confirm == null || String(body.password) !== String(confirm)) {
      return json({ error: 'Las contraseñas no coinciden' }, 400);
    }
    const takenUser = await authService.findUserByUsername(db, userV.username);
    if (takenUser) return json({ error: 'Ese ID ya está en uso' }, 409);
    const existing = await authService.findUserByEmail(db, emailV.email);
    if (existing) return json({ error: 'No se pudo crear la cuenta' }, 409);
    try {
      const user = await authService.createUserPassword(db, {
        username: userV.username,
        name: nameV.name,
        phone: phoneV.phone,
        email: emailV.email,
        password: passV.password,
      });
      const session = await authService.createAuthSession(db, user.id, {
        ip: clientIp(request),
      });
      const premCookie = premiumService.sessionCookieFromHeader(request.headers.get('cookie'));
      if (premCookie) {
        await premiumService.attachPremiumSessionToUser(db, premCookie, user.id).catch(() => {});
      }
      return json(
        { user: authService.publicUser(user) },
        201,
        { 'set-cookie': authService.authCookieHeader(session.cookieValue) }
      );
    } catch (err) {
      const msg = String(err?.message || '');
      if (/UNIQUE|constraint/i.test(msg)) {
        return json({ error: 'Ese ID ya está en uso' }, 409);
      }
      return json({ error: err.message || 'Error al registrar' }, 500);
    }
  }

  if (method === 'POST' && path === '/api/v1/auth/login') {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      return json({ error: 'JSON inválido' }, 400);
    }
    const identifier = String(body.identifier ?? body.email ?? '').trim();
    const passV = authService.validatePassword(body.password || 'x');
    const rate = authService.checkLoginRateLimit(`${clientIp(request)}:${identifier || 'x'}`);
    if (!rate.ok) return json({ error: rate.error }, 429);
    const generic = 'Usuario o contraseña incorrectos';
    if (!identifier || !passV.ok) return json({ error: generic }, 401);
    const user = await authService.findUserByLoginIdentifier(db, identifier);
    if (!user || !user.password_hash) return json({ error: generic }, 401);
    if (Number(user.disabled) === 1) return json({ error: generic }, 401);
    const ok = await authService.verifyPassword(passV.password, user.password_hash);
    if (!ok) return json({ error: generic }, 401);
    const session = await authService.createAuthSession(db, user.id, {
      ip: clientIp(request),
    });
    const premCookie = premiumService.sessionCookieFromHeader(request.headers.get('cookie'));
    if (premCookie) {
      await premiumService.attachPremiumSessionToUser(db, premCookie, user.id).catch(() => {});
    }
    return json(
      { user: authService.publicUser(user) },
      200,
      { 'set-cookie': authService.authCookieHeader(session.cookieValue) }
    );
  }

  if (method === 'GET' && path === '/api/v1/auth/me') {
    const cookieValue = authService.authCookieFromHeader(request.headers.get('cookie'));
    const { user } = await authService.resolveAuthSession(db, cookieValue);
    if (!user) return json({ user: null });
    return json({ user: authService.publicUser(user) });
  }

  if (method === 'POST' && path === '/api/v1/auth/premium-sanction/ack') {
    const user = await authUserOf(request, db);
    if (!user) return json({ error: 'No autenticado' }, 401);
    await db.run(`UPDATE users SET premium_sanction_at = NULL WHERE id = ?1`, String(user.id));
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/api/v1/auth/logout') {
    const cookieValue = authService.authCookieFromHeader(request.headers.get('cookie'));
    await authService.revokeAuthSession(db, cookieValue);
    return json({ ok: true }, 200, { 'set-cookie': authService.clearAuthCookieHeader() });
  }

  if (method === 'GET' && path === '/api/v1/auth/google/start') {
    if (!authService.googleConfigured(env)) {
      return json({ error: 'Google no configurado' }, 503);
    }
    if (!env.AUTH_SECRET) {
      return json({ error: 'AUTH_SECRET no configurado' }, 503);
    }
    const state = await authService.createOAuthState(env);
    const url = authService.googleAuthUrl(env, request, state);
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        'set-cookie': authService.oauthStateCookieHeader(state),
      },
    });
  }

  if (method === 'GET' && path === '/api/v1/auth/google/callback') {
    const url = new URL(request.url);
    const errQ = url.searchParams.get('error');
    if (errQ) {
      return Response.redirect(`${authService.publicOrigin(request, env)}/?auth=google_error`, 302);
    }
    if (!authService.googleConfigured(env) || !env.AUTH_SECRET) {
      return Response.redirect(`${authService.publicOrigin(request, env)}/?auth=google_unconfigured`, 302);
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookieState = authService.oauthStateFromHeader(request.headers.get('cookie'));
    const stateOk =
      state &&
      cookieState &&
      state === cookieState &&
      (await authService.verifyOAuthState(env, state));
    if (!code || !stateOk) {
      return Response.redirect(`${authService.publicOrigin(request, env)}/?auth=google_state`, 302);
    }
    try {
      const profile = await authService.exchangeGoogleCode(env, request, code);
      const user = await authService.upsertGoogleUser(db, profile);
      if (Number(user.disabled) === 1) {
        return Response.redirect(`${authService.publicOrigin(request, env)}/?auth=google_error`, 302);
      }
      const session = await authService.createAuthSession(db, user.id, {
        ip: clientIp(request),
      });
      const premCookie = premiumService.sessionCookieFromHeader(request.headers.get('cookie'));
      if (premCookie) {
        await premiumService.attachPremiumSessionToUser(db, premCookie, user.id).catch(() => {});
      }
      const headers = new Headers({
        Location: `${authService.publicOrigin(request, env)}/?auth=ok`,
      });
      headers.append('set-cookie', authService.authCookieHeader(session.cookieValue));
      headers.append('set-cookie', authService.clearOauthStateCookieHeader());
      return new Response(null, { status: 302, headers });
    } catch (_) {
      return Response.redirect(`${authService.publicOrigin(request, env)}/?auth=google_error`, 302);
    }
  }

  if (method === 'POST' && path === '/api/v1/auth/delete') {
    const user = await authUserOf(request, db);
    if (!user) return json({ error: 'No autenticado' }, 401);
    try {
      await authService.deleteUser(db, user.id);
    } catch (err) {
      return json({ error: err?.message || 'No se pudo eliminar la cuenta' }, 500);
    }
    return json(
      { ok: true },
      200,
      { 'set-cookie': authService.clearAuthCookieHeader() }
    );
  }

  if (method === 'GET' && path === '/api/v1/premium/status') {
    const user = await authUserOf(request, db);
    const { premium, session } = await premiumSessionOf(request, db, user?.id || null);
    const meta = premiumService.premiumMetaFromRow(session);
    const pending = user?.id
      ? await premiumService.getPendingPromoDiscount(db, user.id)
      : { percent: null, code: null };
    return json({
      premium,
      premiumUntil: premium && session ? session.premium_until : null,
      premiumStartedAt: meta.premiumStartedAt,
      plan: meta.plan,
      premiumDaysLeft: meta.premiumDaysLeft,
      stripeConfigured: premiumService.stripeConfigured(env),
      pendingPromoPercent: pending.percent,
      pendingPromoCode: pending.code,
    });
  }

  if (method === 'POST' && path === '/api/v1/premium/session') {
    const user = await authUserOf(request, db);
    const cookieValue = premiumService.sessionCookieFromHeader(request.headers.get('cookie'));
    let { premium, session } = await premiumService.resolvePremiumSession(db, cookieValue);
    let setCookie = null;
    if (!session || !cookieValue) {
      const created = await premiumService.createPremiumSession(db, {
        userId: user?.id || null,
      });
      const cookie = premiumService.sessionCookieHeader(created.cookieValue);
      setCookie = cookie.toSetCookieString();
      session = { id: created.id, premium_until: null, active: 1, user_id: user?.id || null };
      premium = false;
    } else if (user?.id) {
      await premiumService.attachPremiumSessionToUser(db, cookieValue, user.id).catch(() => {});
    }
    const pending = user?.id
      ? await premiumService.getPendingPromoDiscount(db, user.id)
      : { percent: null, code: null };
    let checkoutUrl = null;
    let appliedPercentOff = null;
    if (premiumService.stripeConfigured(env)) {
      const checkout = await premiumService.createStripeCheckout(env, String(session.id), {
        origin: new URL(request.url).origin,
        percentOff: pending.percent || null,
      });
      checkoutUrl = checkout.url || null;
      appliedPercentOff = checkout.percentOff || null;
    }
    return json(
      {
        premium,
        premiumUntil: premium ? session.premium_until : null,
        stripeConfigured: premiumService.stripeConfigured(env),
        checkoutUrl,
        pendingPromoPercent: pending.percent,
        appliedPercentOff,
      },
      200,
      setCookie ? { 'set-cookie': setCookie } : null
    );
  }

  if (method === 'POST' && path === '/api/v1/premium/webhook') {
    const raw = await request.text();
    const valid = await premiumService.verifyStripeSignature(
      raw,
      request.headers.get('stripe-signature'),
      env.STRIPE_WEBHOOK_SECRET,
      new Date()
    );
    if (!valid) {
      return json({ error: 'Firma de webhook invalida' }, 400);
    }
    let event = null;
    try {
      event = JSON.parse(raw);
    } catch (_) {
      return json({ error: 'Payload no es JSON' }, 400);
    }
    const applied = await premiumService.applyStripeEvent(db, env, event);
    return json({ ok: true, ...applied });
  }

  if (method === 'POST' && path === '/api/v1/premium/promo') {
    const user = await authUserOf(request, db);
    if (!user?.id) return json({ error: 'No autenticado', errorCode: 'auth_required' }, 401);
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const result = await premiumService.redeemPromoCode(db, user.id, body.code);
    if (!result.ok) {
      const status =
        result.error === 'auth_required'
          ? 401
          : result.error === 'already_used'
            ? 409
            : 400;
      return json(
        { ok: false, error: result.message || 'Código no válido', errorCode: result.error },
        status
      );
    }
    return json({
      ok: true,
      premiumUntil: result.premiumUntil,
      days: result.days,
      code: result.code,
      type: result.type,
      kind: result.kind,
      percentOff: result.percentOff ?? null,
    });
  }

  if (method === 'POST' && path === '/api/v1/telemetry/hit') {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const ip = clientIp(request);
    const country =
      request.headers.get('cf-ipcountry') ||
      (request.cf && request.cf.country) ||
      '';
    const ua = request.headers.get('user-agent') || '';
    const host = request.headers.get('host') || url.host || '';
    const hitPath = body.path || url.searchParams.get('path') || '/';
    const referrerHost = pageHitsService.referrerHostOf(
      body.referrer || request.headers.get('referer') || ''
    );
    const work = pageHitsService.recordHit(db, {
      ip,
      path: hitPath,
      country,
      ua,
      host,
      referrerHost,
    });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(work.catch(() => {}));
      return json({ ok: true }, 202);
    }
    const result = await work;
    return json({ ok: true, ...result });
  }

  if (method === 'GET' && path === '/api/v1/admin/visits/recent') {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    const limit = url.searchParams.get('limit');
    const [uniqueIpsToday, hits] = await Promise.all([
      pageHitsService.countUniqueIpsToday(db),
      pageHitsService.listRecent(db, { limit }),
    ]);
    return json({ uniqueIpsToday, hits });
  }

  if (method === 'GET' && path === '/api/v1/admin/usage/today') {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    const { start, end } = cfUsageService.todayUtcWindow();
    const day = start.slice(0, 10);
    const [usage, loginsToday] = await Promise.all([
      cfUsageService.fetchWorkerUsageToday(env),
      authService.countLoginsToday(db, { startIso: start, endIso: end }),
    ]);
    return json({
      ...usage,
      day: usage.day || day,
      loginsToday,
    });
  }

  if (method === 'GET' && path === '/api/v1/admin/usage/daily') {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    const from = url.searchParams.get('from') || undefined;
    const to = url.searchParams.get('to') || undefined;
    const daily = await cfUsageService.fetchWorkerUsageDaily(env, { from, to });
    return json(daily);
  }

  if (method === 'GET' && path === '/api/v1/admin/usage/visits') {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    const day = url.searchParams.get('day') || undefined;
    const visits = await cfUsageService.fetchWebAnalyticsVisits(env, { day });
    return json(visits);
  }

  if (method === 'GET' && path === '/api/v1/admin/users') {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    const users = await authService.listUsersAdmin(db);
    return json({ users });
  }

  {
    const revokeMatch = path.match(/^\/api\/v1\/admin\/users\/([^/]+)\/revoke$/);
    if (method === 'POST' && revokeMatch) {
      const gate = checkAdminSecret(request, env);
      if (!gate.ok) return json({ error: gate.error }, gate.status);
      const id = decodeURIComponent(revokeMatch[1]);
      const existing = await authService.findUserById(db, id);
      if (!existing) return json({ error: 'Usuario no encontrado' }, 404);
      const user = await authService.setUserDisabled(db, id, true);
      return json({ ok: true, user: authService.adminUserRow(user) });
    }
  }

  {
    const enableMatch = path.match(/^\/api\/v1\/admin\/users\/([^/]+)\/enable$/);
    if (method === 'POST' && enableMatch) {
      const gate = checkAdminSecret(request, env);
      if (!gate.ok) return json({ error: gate.error }, gate.status);
      const id = decodeURIComponent(enableMatch[1]);
      const existing = await authService.findUserById(db, id);
      if (!existing) return json({ error: 'Usuario no encontrado' }, 404);
      const user = await authService.setUserDisabled(db, id, false);
      return json({ ok: true, user: authService.adminUserRow(user) });
    }
  }

  {
    const deleteMatch = path.match(/^\/api\/v1\/admin\/users\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const gate = checkAdminSecret(request, env);
      if (!gate.ok) return json({ error: gate.error }, gate.status);
      const id = decodeURIComponent(deleteMatch[1]);
      const existing = await authService.findUserById(db, id);
      if (!existing) return json({ error: 'Usuario no encontrado' }, 404);
      try {
        await authService.deleteUser(db, id);
      } catch (err) {
        return json({ error: err?.message || 'Error al eliminar usuario' }, 500);
      }
      return json({ ok: true, id });
    }
  }

  if (method === 'POST' && path === '/api/v1/admin/premium/grant') {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const days = Math.max(1, Math.min(365, Number(body.days) || 30));
    if (body.userId) {
      const granted = await premiumService.grantPremiumForUser(db, String(body.userId), { days });
      return json({
        ok: true,
        userId: String(body.userId),
        id: granted.id,
        premiumUntil: granted.premiumUntil,
      });
    }
    if (body.id) {
      const until = await premiumService.grantPremium(db, String(body.id), { days });
      return json({ ok: true, id: String(body.id), premiumUntil: until });
    }
    const created = await premiumService.createPremiumSession(db);
    const until = await premiumService.grantPremium(db, created.id, { days });
    return json({
      ok: true,
      id: created.id,
      premiumUntil: until,
      cookieValue: created.cookieValue,
      note: 'Entregar este cookieValue como hb_prem al beneficiario (promo/reembolso).',
    });
  }

  if (method === 'POST' && path === '/api/v1/admin/premium/revoke') {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const userId = body.userId ? String(body.userId) : '';
    if (!userId) return json({ error: 'userId requerido' }, 400);
    const existing = await authService.findUserById(db, userId);
    if (!existing) return json({ error: 'Usuario no encontrado' }, 404);
    const result = await premiumService.revokePremiumForUser(db, userId, {
      sanction: Boolean(body.sanction),
    });
    return json({ ok: true, ...result });
  }

  if (method === 'GET' && path === '/api/v1/admin/promo') {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    const codes = await premiumService.listPromoCodes(db);
    return json({ ok: true, codes });
  }

  if (method === 'POST' && path === '/api/v1/admin/promo') {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const created = await premiumService.createPromoCode(db, {
      code: body.code,
      type: body.type,
      days: body.days,
      maxRedemptions: body.maxRedemptions,
      expiresAt: body.expiresAt || null,
    });
    if (!created.ok) {
      return json(
        { ok: false, error: created.message || 'No se pudo crear', errorCode: created.error },
        created.error === 'exists' ? 409 : 400
      );
    }
    return json(created);
  }

  const adminPromoDelete = path.match(/^\/api\/v1\/admin\/promo\/([^/]+)$/);
  if (
    adminPromoDelete &&
    (method === 'DELETE' || (method === 'POST' && url.searchParams.get('action') === 'delete'))
  ) {
    const gate = checkAdminSecret(request, env);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    const code = decodeURIComponent(adminPromoDelete[1] || '');
    const result = await premiumService.deletePromoCode(db, code);
    if (!result.ok) {
      return json(
        { ok: false, error: result.message || 'No se pudo eliminar', errorCode: result.error },
        result.error === 'not_found' ? 404 : 400
      );
    }
    return json(result);
  }

  if (method === 'POST' && path === '/api/v1/matches/refresh-live') {
    const force = url.searchParams.get('force') === '1';
    const wait = url.searchParams.get('wait') === '1';
    const result = await handleLiveRefreshRequest(env, db, ctx, { force, wait });
    return json(result);
  }

  const liveMatch = path.match(/^\/api\/v1\/matches\/(\d+)\/live$/);
  if (method === 'POST' && liveMatch) {
    const matchId = Number(liveMatch[1]);
    const match = await store.findMatchById(db, matchId);
    if (!match) return json({ error: 'Partido no encontrado' }, 404);
    const force = url.searchParams.get('force') === '1';
    const wait = url.searchParams.get('wait') === '1';
    // Shares the cooldown of the global refresh: it stays cheap on repeated calls.
    await handleLiveRefreshRequest(env, db, ctx, { force, wait });
    let fresh = (await store.findMatchById(db, matchId)) || match;
    fresh = (await ensureMatchEventsFresh(env, db, matchId)) || fresh;
    const prediction = await store.getPredictionByMatchId(db, matchId);
    return json({
      ok: true,
      match: fresh,
      live: buildLiveBlock(fresh, prediction),
    });
  }

  const predMatch = path.match(/^\/api\/v1\/matches\/(\d+)\/prediction$/);
  if (method === 'GET' && predMatch) {
    try {
      const bundle = await getPredictionBundle(db, Number(predMatch[1]));
      return json(bundle);
    } catch (err) {
      return json({ error: err.message }, 404);
    }
  }

  if (method === 'GET' && path === '/api/v1/leagues') {
    return json({ leagues: await store.listLeagues(db) });
  }

  const leagueTableMatch = path.match(/^\/api\/v1\/leagues\/(\d+)\/table$/);
  if (method === 'GET' && leagueTableMatch) {
    const apiId = Number(leagueTableMatch[1]);
    const league = await store.findLeagueByApiId(db, apiId);
    if (!league) return json({ error: 'Liga no encontrada' }, 404);
    const raw = await store.getLeagueTable(db, league.id, 40);
    const table = raw.map((row) => ({
      ...row,
      logoUrl: resolveTeamLogoUrl(row.team, row.logoUrl),
    }));
    return json({
      league: {
        id: Number(league.id),
        apiId: Number(league.api_id),
        name: league.name,
        country: league.country || null,
      },
      table,
      emptyReason: table.length ? null : 'Sin clasificatorio aún',
    });
  }

  if (method === 'GET' && path === '/api/v1/teams/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return json({ error: 'Parámetro q requerido' }, 400);
    const teams = await store.searchTeams(db, q);
    return json({
      teams: teams.map((t) => ({
        ...t,
        logo_url: resolveTeamLogoUrl(t.name, t.logo_url),
      })),
    });
  }

  const teamMatch = path.match(/^\/api\/v1\/teams\/(\d+)$/);
  if (method === 'GET' && teamMatch) {
    const id = Number(teamMatch[1]);
    const team = await store.findTeamById(db, id);
    if (!team) return json({ error: 'Equipo no encontrado' }, 404);
    const stats = await store.lastNForTeam(db, id, 5);
    const nextMatch = await store.getNextForTeam(db, id);
    let prediction = null;
    if (nextMatch) prediction = await getPredictionBundle(db, nextMatch.id);
    return json({
      team,
      form: store.formFromStats(stats),
      last5: stats,
      nextMatch,
      prediction,
    });
  }

  if (method === 'GET' && path === '/api/v1/crests/audit') {
    const { auditCrestsForLeague, TOP5_CREST_ROSTERS } = await import(
      './services/teamLogos.js'
    );
    const leagueId = url.searchParams.get('leagueId');
    const ids = leagueId
      ? [Number(leagueId)]
      : Object.keys(TOP5_CREST_ROSTERS).map(Number);
    const reports = ids.map((id) => auditCrestsForLeague(id));
    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      reports,
    });
  }

  if (method === 'GET' && path === '/api/v1/crests/verifications') {
    const leagueId = url.searchParams.get('leagueId');
    const rows = await store.listCrestVerifications(
      db,
      leagueId != null ? Number(leagueId) : null,
      300
    );
    return json({ ok: true, count: rows.length, rows });
  }

  if (method === 'POST' && path === '/api/v1/admin/crests/audit') {
    const secret = env.SYNC_SECRET || 'change-me-houdini';
    const header = request.headers.get('x-sync-secret');
    if (!header || header !== secret) {
      return json({ error: 'No autorizado. Header x-sync-secret requerido.' }, 401);
    }
    const { auditCrestsForLeague, TOP5_CREST_ROSTERS } = await import(
      './services/teamLogos.js'
    );
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const leagueId = body.leagueId != null ? Number(body.leagueId) : null;
    const ids = leagueId
      ? [leagueId]
      : Object.keys(TOP5_CREST_ROSTERS).map(Number);
    const reports = [];
    let inserted = 0;
    for (const id of ids) {
      const report = auditCrestsForLeague(id);
      reports.push(report);
      for (const r of report.rows) {
        await store.insertCrestVerification(db, {
          league_api_id: r.leagueApiId,
          team_api_id: r.teamApiId,
          team_name: r.team,
          logo_url: r.logoUrl,
          reference_url: r.referenceUrl,
          reference_source: r.referenceSource,
          status: r.status,
          problem: r.problem,
          action: r.action,
          evidence: r.evidence,
        });
        inserted += 1;
      }
    }
    let logosRewritten = 0;
    try {
      logosRewritten = await store.rewriteBrokenTeamLogos(db, resolveTeamLogoUrl);
    } catch (_) {
      logosRewritten = 0;
    }
    return json({ ok: true, inserted, logosRewritten, reports });
  }

  if (method === 'POST' && path === '/api/v1/admin/stats/reset') {
    const secret = env.SYNC_SECRET || 'change-me-houdini';
    const header = request.headers.get('x-sync-secret');
    if (!header || header !== secret) {
      return json({ error: 'No autorizado. Header x-sync-secret requerido.' }, 401);
    }
    const keepDateParam = url.searchParams.get('keepDate');
    const keepToday = url.searchParams.get('keepToday') === '1';
    const keepDate = keepToday
      ? new Date().toISOString().slice(0, 10)
      : keepDateParam && /^\d{4}-\d{2}-\d{2}$/.test(keepDateParam)
        ? keepDateParam
        : null;
    const wiped = await store.resetStatsLedgers(db, keepDate ? { keepDate } : {});
    let calibration = null;
    try {
      calibration = await fitTipCalibration(db, 90, { includeMidBands: false });
    } catch (_) {
      calibration = null;
    }
    return json({
      ok: true,
      tipsDeleted: wiped.tipsDeleted,
      tipsKept: wiped.tipsKept || 0,
      keptMatchIds: wiped.keptMatchIds || [],
      keepDate: wiped.keepDate || null,
      combosDeleted: wiped.combosDeleted,
      statsResetAt: wiped.statsResetAt || null,
      calibrationDecided: calibration?.decided ?? null,
      note: keepDate
        ? `tip_results anteriores a ${keepDate} + combo_results vaciados; tips del día conservados. Stats desde statsResetAt.`
        : 'tip_results + combo_results vaciados. Stats cuenta desde statsResetAt. Matches/predictions/odds intactos.',
    });
  }

  if (method === 'POST' && path === '/api/v1/admin/matches/repair-future-finished') {
    const secret = env.SYNC_SECRET || 'change-me-houdini';
    const header = request.headers.get('x-sync-secret');
    if (!header || header !== secret) {
      return json({ error: 'No autorizado. Header x-sync-secret requerido.' }, 401);
    }
    const result = await store.repairFutureFinishedMatches(db);
    return json({
      ok: true,
      ...result,
      note:
        'Partidos finished con kickoff futuro → scheduled; goles/events/fotmob limpios; tip_results borrados.',
    });
  }

  if (method === 'POST' && path === '/api/v1/admin/tips/sync-predictions') {
    const secret = env.SYNC_SECRET || 'change-me-houdini';
    const header = request.headers.get('x-sync-secret');
    if (!header || header !== secret) {
      return json({ error: 'No autorizado. Header x-sync-secret requerido.' }, 401);
    }
    const repaired = await store.repairPredictionsToLockedTips(db, 500);
    return json({
      ok: true,
      repaired,
      note:
        'predictions.suggested_bet alineado con tip_results (live/finished). Stats no cambia; el panel muestra el tip asentado.',
    });
  }

  if (method === 'POST' && path === '/api/v1/sync/manual') {
    const secret = env.SYNC_SECRET || 'change-me-houdini';
    const header = request.headers.get('x-sync-secret');
    if (!header || header !== secret) {
      return json({ error: 'No autorizado. Header x-sync-secret requerido.' }, 401);
    }
    await store.setMeta(db, 'sync_started_at', new Date().toISOString());
    const result = await runDailySync(env, db);
    // Chain AF enrich when key present so manual sync also fills book odds.
    let enrich = null;
    if (env.API_FOOTBALL_KEY && String(env.API_FOOTBALL_KEY).trim()) {
      try {
        enrich = await runAfEnrichOnly(env, db);
      } catch (err) {
        enrich = { ok: false, error: err.message || String(err) };
      }
    }
    return json({ ...result, enrich });
  }

  if (method === 'POST' && path === '/api/v1/sync/enrich') {
    const secret = env.SYNC_SECRET || 'change-me-houdini';
    const header = request.headers.get('x-sync-secret');
    if (!header || header !== secret) {
      return json({ error: 'No autorizado. Header x-sync-secret requerido.' }, 401);
    }
    const result = await runAfEnrichOnly(env, db);
    return json(result, result.ok ? 200 : 400);
  }

  if (method === 'POST' && path === '/api/v1/admin/backtest') {
    const secret = env.SYNC_SECRET || 'change-me-houdini';
    const header = request.headers.get('x-sync-secret');
    if (!header || header !== secret) {
      return json({ error: 'No autorizado. Header x-sync-secret requerido.' }, 401);
    }
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const days = Math.min(180, Math.max(7, Number(body.days) || 60));
    const limit = Math.min(800, Math.max(50, Number(body.limit) || 400));
    const holdoutDays = Math.min(60, Math.max(3, Number(body.holdoutDays) || 14));
    const suiteOpts = { days, limit, holdoutDays };
    if (Array.isArray(body.modes) && body.modes.length) {
      // runBacktestSuite always compares core engines; modes reserved for future filter
      suiteOpts.modes = body.modes;
    }
    if (body.tune === true || body.tune === 1 || body.tune === '1') {
      suiteOpts.tune = true;
    }
    if (body.kalman && typeof body.kalman === 'object') {
      suiteOpts.kalman = body.kalman;
    }
    const result = await runBacktestSuite(db, suiteOpts);
    return json(result);
  }

  if (method === 'POST' && path === '/api/v1/admin/ratings/backfill') {
    const secret = env.SYNC_SECRET || 'change-me-houdini';
    const header = request.headers.get('x-sync-secret');
    if (!header || header !== secret) {
      return json({ error: 'No autorizado. Header x-sync-secret requerido.' }, 401);
    }
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const days = Math.min(180, Math.max(7, Number(body.days) || 60));
    const limit = Math.min(800, Math.max(50, Number(body.limit) || 400));
    const result = await backfillRatings(db, { days, limit });
    return json({ ok: true, ...result });
  }

  if (method === 'POST' && path === '/api/v1/admin/ratings/live') {
    const secret = env.SYNC_SECRET || 'change-me-houdini';
    const header = request.headers.get('x-sync-secret');
    if (!header || header !== secret) {
      return json({ error: 'No autorizado. Header x-sync-secret requerido.' }, 401);
    }
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const enable = body.enable === true || body.enable === 1 || body.enable === '1';
    await store.setMeta(db, 'ratings_live', enable ? '1' : '0');
    return json({ ok: true, ratings_live: enable ? '1' : '0' });
  }

  if (method === 'GET' && path === '/health') {
    return json({ ok: true, service: 'houdini-bet', runtime: 'cloudflare-workers' });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
        return await handleApi(request, env, ctx);
      }
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response('Houdini Bet Worker', { status: 200 });
    } catch (err) {
      console.error(err);
      return json({ error: err.message || 'Error interno' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    const db = createDb(env.DB);
    const cron = event.cron || '';
    if (cron === '30 6 * * *' || cron === '0 12 * * *') {
      ctx.waitUntil(
        runAfEnrichOnly(env, db).then((r) => console.log('cron af-enrich', JSON.stringify(r)))
      );
      return;
    }
    if (cron === LIVE_CRON) {
      ctx.waitUntil(
        runLiveCronSafe(env, db).then((r) => console.log('cron live', JSON.stringify(r)))
      );
      return;
    }
    ctx.waitUntil(
      runDailySync(env, db).then((r) => console.log('cron sync', JSON.stringify(r)))
    );
  },
};
