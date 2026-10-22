import { createDb } from './db.js';
import * as store from './db.js';
import { getPredictionBundle, predictMany } from './services/predictionService.js';
import { runDailySync, runAfEnrichOnly, runLiveStatusRefresh, runLiveCron } from './services/syncService.js';
import { WINDOW_DAYS } from './services/fixtureDownload.js';
import { resolveTeamLogoUrl } from './services/teamLogos.js';
import { resolveTipOdds, parseOddsBandParam, pickLegForCombo, BAND_META } from './services/oddsBands.js';
import { buildCombos, comboOptsForBand } from './services/combos.js';
import { loadTipCalibration, fitTipCalibration } from './services/calibration.js';
import { runBacktestSuite } from './services/backtestService.js';
import { backfillRatings } from './services/ratingsService.js';
import { buildLiveBlock } from './services/liveModel.js';

const STALE_MS = 12 * 60 * 60 * 1000;
const SYNC_LOCK_MS = 5 * 60 * 1000;
/** Live refresh cron: every 10 minutes during the European match window (UTC). */
const LIVE_CRON = '*/10 15-23 * * *';

/** Missing preds only on list GETs — cap 5. Full recompute runs in sync/cron. */
function missingPredictionIds(allIds, existingMap, cap = 5) {
  const missing = [];
  for (const id of allIds) {
    if (!existingMap.get(id)) missing.push(id);
    if (missing.length >= cap) break;
  }
  return missing;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-sync-secret',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });
}

function parseDays(url, fallback = WINDOW_DAYS) {
  const daysParam = url.searchParams.get('days');
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
  return {
    matchId: r.match_id,
    matchDate: r.match_date,
    leagueId: r.league_id != null ? Number(r.league_id) : null,
    league: r.league_name,
    leagueCountry: r.league_country || null,
    homeTeam: { name: r.home_name, logo: resolveTeamLogoUrl(r.home_name, r.home_logo) },
    awayTeam: { name: r.away_name, logo: resolveTeamLogoUrl(r.away_name, r.away_logo) },
    suggestedBet: r.suggested_bet,
    secondaryBet: r.secondary_bet,
    confidenceScore: Number(r.confidence_score),
    highConfidence: Number(r.confidence_score) >= 60,
    valueEdge: r.value_edge != null ? Number(r.value_edge) : null,
    valueMarket: r.value_market,
    tipOdds: oddsMeta.tipOdds,
    oddsBand: oddsMeta.oddsBand,
    oddsSource: oddsMeta.oddsSource,
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
    if (fdCount > 0) {
      mode = 'live';
      message = hasKey
        ? `FD + API-Football: ${upcomingWithOdds}/${upcoming} con cuota (${oddsCoveragePct ?? 0}%) · corners=${cornersCount} · amarillas=${yellowsCount}.`
        : `Calendario FD (${fdCount} partidos). Sin API_FOOTBALL_KEY → sin value, corners ni amarillas.`;
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
      oddsMatchCount: oddsCount,
      cornersMatchCount: cornersCount,
      yellowsMatchCount: yellowsCount,
      shotsOnTargetMatchCount: shotsOnTargetCount,
      upcomingCount: upcoming,
      upcomingWithOdds,
      oddsCoveragePct,
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
    const missing = missingPredictionIds(allIds, existing, 5);
    if (missing.length) await predictMany(db, missing);
    const predMap = await store.getPredictionsByMatchIds(db, allIds);
    const oddsMap = await store.getOddsByMatchIds(db, allIds);
    const enriched = matches.map((m) => {
      const p = predMap.get(m.id);
      const odds = oddsMap.get(m.id);
      const oddsMeta = tipOddsMeta(p?.suggested_bet, p, odds);
      return {
        ...m,
        suggestedBet: p?.suggested_bet ?? null,
        secondaryBet: p?.secondary_bet ?? null,
        confidenceScore: p?.confidence_score != null ? Number(p.confidence_score) : null,
        valueEdge: p?.value_edge != null ? Number(p.value_edge) : null,
        valueMarket: p?.value_market ?? null,
        tipOdds: oddsMeta.tipOdds,
        oddsBand: oddsMeta.oddsBand,
        oddsSource: oddsMeta.oddsSource,
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

  if (method === 'GET' && path === '/api/v1/matches/best-bets') {
    const win = parseMatchWindow(url);
    const oddsBand = parseOddsBandParam(url.searchParams.get('oddsBand'));
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
    const missing = missingPredictionIds(ids, existing, 5);
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
    bets = bets.slice(0, limit);
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
    const perf = await store.getTipPerformance(db, win);
    let calib = await loadTipCalibration(db);
    if (!calib) {
      try {
        // Fast bootstrap (tips only); full mid-band fit runs on daily sync.
        calib = await fitTipCalibration(db, 90, { includeMidBands: false });
      } catch (_) {
        calib = null;
      }
    }
    return json({
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
      recent: (perf.recent || []).map((r) => ({
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
    });
  }
  if (method === 'POST' && path === '/api/v1/matches/refresh-live') {
    const force = url.searchParams.get('force') === '1';
    const result = await runLiveStatusRefresh(env, db, { force });
    return json(result);
  }

  const liveMatch = path.match(/^\/api\/v1\/matches\/(\d+)\/live$/);
  if (method === 'POST' && liveMatch) {
    const matchId = Number(liveMatch[1]);
    const match = await store.findMatchById(db, matchId);
    if (!match) return json({ error: 'Partido no encontrado' }, 404);
    const force = url.searchParams.get('force') === '1';
    // Shares the cooldown of the global refresh: it stays cheap on repeated calls.
    await runLiveStatusRefresh(env, db, { force });
    const fresh = (await store.findMatchById(db, matchId)) || match;
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
        runLiveCron(env, db).then((r) => console.log('cron live', JSON.stringify(r)))
      );
      return;
    }
    ctx.waitUntil(
      runDailySync(env, db).then((r) => console.log('cron sync', JSON.stringify(r)))
    );
  },
};
