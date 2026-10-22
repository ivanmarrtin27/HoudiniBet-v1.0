#!/usr/bin/env node
require('dotenv').config();
const chalk = require('chalk');
const inquirer = require('inquirer');
const Table = require('cli-table3');
const matchModel = require('./models/match');
const teamModel = require('./models/team');
const leagueModel = require('./models/league');
const teamStats = require('./models/teamStats');
const predictionService = require('./services/predictionService');
const syncService = require('./services/syncService');
const { LOG_FILE } = require('./services/logger');
const { isRemote, remoteJson, API_BASE } = require('./remoteApi');
const fs = require('fs');

const WINDOW_DAYS = 14;
const TZ = 'Europe/Madrid';
const MIN_CONF = 55;
const MIN_BEST_CONF = 60;
const MIN_VALUE = 0.05;

const BET_LABELS = {
  HOME_WIN: 'Victoria local',
  DRAW: 'Empate',
  AWAY_WIN: 'Victoria visitante',
  OVER_15: 'Más de 1,5 goles',
  UNDER_15: 'Menos de 1,5 goles',
  OVER_25: 'Más de 2,5 goles',
  UNDER_25: 'Menos de 2,5 goles',
  OVER_35: 'Más de 3,5 goles',
  UNDER_35: 'Menos de 3,5 goles',
  BTTS_YES: 'Ambos marcan — Sí',
  BTTS_NO: 'Ambos marcan — No',
  HOME_OVER_05: 'Local · Más de 0,5 goles',
  HOME_UNDER_05: 'Local · Menos de 0,5 goles',
  HOME_OVER_15: 'Local · Más de 1,5 goles',
  HOME_UNDER_15: 'Local · Menos de 1,5 goles',
  HOME_OVER_25: 'Local · Más de 2,5 goles',
  HOME_UNDER_25: 'Local · Menos de 2,5 goles',
  HOME_OVER_35: 'Local · Más de 3,5 goles',
  HOME_UNDER_35: 'Local · Menos de 3,5 goles',
  AWAY_OVER_05: 'Visitante · Más de 0,5 goles',
  AWAY_UNDER_05: 'Visitante · Menos de 0,5 goles',
  AWAY_OVER_15: 'Visitante · Más de 1,5 goles',
  AWAY_UNDER_15: 'Visitante · Menos de 1,5 goles',
  AWAY_OVER_25: 'Visitante · Más de 2,5 goles',
  AWAY_UNDER_25: 'Visitante · Menos de 2,5 goles',
  AWAY_OVER_35: 'Visitante · Más de 3,5 goles',
  AWAY_UNDER_35: 'Visitante · Menos de 3,5 goles',
  CORNERS_OVER_85: 'Más de 8,5 córners',
  CORNERS_UNDER_85: 'Menos de 8,5 córners',
  CORNERS_OVER_95: 'Más de 9,5 córners',
  CORNERS_UNDER_95: 'Menos de 9,5 córners',
  CORNERS_OVER_105: 'Más de 10,5 córners',
  CORNERS_UNDER_105: 'Menos de 10,5 córners',
  CARDS_OVER_35: 'Más de 3,5 amarillas',
  CARDS_UNDER_35: 'Menos de 3,5 amarillas',
  CARDS_OVER_45: 'Más de 4,5 amarillas',
  CARDS_UNDER_45: 'Menos de 4,5 amarillas',
};

/** Compact labels for table Tip column */
const SHORT_BET_LABELS = {
  HOME_WIN: '1',
  DRAW: 'X',
  AWAY_WIN: '2',
  OVER_15: '+1,5',
  UNDER_15: '−1,5',
  OVER_25: '+2,5',
  UNDER_25: '−2,5',
  OVER_35: '+3,5',
  UNDER_35: '−3,5',
  BTTS_YES: 'Ambos sí',
  BTTS_NO: 'Ambos no',
  HOME_OVER_05: 'Loc +0,5',
  HOME_UNDER_05: 'Loc −0,5',
  HOME_OVER_15: 'Loc +1,5',
  HOME_UNDER_15: 'Loc −1,5',
  HOME_OVER_25: 'Loc +2,5',
  HOME_UNDER_25: 'Loc −2,5',
  HOME_OVER_35: 'Loc +3,5',
  HOME_UNDER_35: 'Loc −3,5',
  AWAY_OVER_05: 'Vis +0,5',
  AWAY_UNDER_05: 'Vis −0,5',
  AWAY_OVER_15: 'Vis +1,5',
  AWAY_UNDER_15: 'Vis −1,5',
  AWAY_OVER_25: 'Vis +2,5',
  AWAY_UNDER_25: 'Vis −2,5',
  AWAY_OVER_35: 'Vis +3,5',
  AWAY_UNDER_35: 'Vis −3,5',
  CORNERS_OVER_85: 'Cór +8,5',
  CORNERS_UNDER_85: 'Cór −8,5',
  CORNERS_OVER_95: 'Cór +9,5',
  CORNERS_UNDER_95: 'Cór −9,5',
  CORNERS_OVER_105: 'Cór +10,5',
  CORNERS_UNDER_105: 'Cór −10,5',
  CARDS_OVER_35: 'Amar +3,5',
  CARDS_UNDER_35: 'Amar −3,5',
  CARDS_OVER_45: 'Amar +4,5',
  CARDS_UNDER_45: 'Amar −4,5',
};

function labelBet(code) {
  return BET_LABELS[code] || code || '—';
}

function shortLabelBet(code) {
  return SHORT_BET_LABELS[code] || BET_LABELS[code] || code || '—';
}

/** Whole percent for user-facing display (71%, never 71.3%). */
function pctWhole(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (v <= 1) return `${Math.round(v * 100)}%`;
  return `${Math.round(v)}%`;
}

function confColor(score) {
  const n = Number(score);
  const text = `${Math.round(n)}%`;
  if (n >= 65) return chalk.green(text);
  if (n >= 50) return chalk.yellow(text);
  return chalk.red(text);
}

function riskLabel(score) {
  const n = Number(score);
  if (n >= 65) return chalk.green('BAJO');
  if (n >= 50) return chalk.yellow('MEDIO');
  return chalk.red('ALTO');
}

function confBar(score, width = 10) {
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  const filled = Math.round((n / 100) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  if (n >= 65) return chalk.green(bar);
  if (n >= 50) return chalk.yellow(bar);
  return chalk.red(bar);
}

function valueBadge(edge) {
  if (edge == null || Number(edge) < MIN_VALUE) return null;
  const pct = Math.round(Number(edge) * 100);
  if (pct > 15) return chalk.blueBright(`EXCEPCIONAL VALUE +${pct}%`);
  if (pct > 10) return chalk.green(`VALUE +${pct}%`);
  return chalk.yellow(`VALUE +${pct}%`);
}

function formBadges(form) {
  if (!form || !form.length) return chalk.gray('Sin historial suficiente');
  return form
    .map((f) => {
      if (f === 'W') return chalk.green('W');
      if (f === 'L') return chalk.red('L');
      return chalk.yellow('D');
    })
    .join(' ');
}

function formWins(form) {
  return (form || []).filter((f) => f === 'W').length;
}

function whyBullets(bundle) {
  const m = bundle.match;
  const homeForm = bundle.form?.home || [];
  const awayForm = bundle.form?.away || [];
  const bullets = [];
  if (homeForm.length) {
    bullets.push(
      `${m.homeTeam.name}: ${formWins(homeForm)} de ${homeForm.length} recientes ganados (${homeForm.join(' ')})`
    );
  } else {
    bullets.push(`${m.homeTeam.name}: sin historial reciente suficiente`);
  }
  if (awayForm.length) {
    bullets.push(
      `${m.awayTeam.name}: ${formWins(awayForm)} de ${awayForm.length} recientes ganados (${awayForm.join(' ')})`
    );
  } else {
    bullets.push(`${m.awayTeam.name}: sin historial reciente suficiente`);
  }
  const tip = bundle.prediction?.suggested_bet;
  if (tip === 'HOME_WIN' && homeForm.length) {
    bullets.push(`El modelo se inclina por victoria de ${m.homeTeam.name}`);
  } else if (tip === 'AWAY_WIN' && awayForm.length) {
    bullets.push(`El modelo se inclina por victoria de ${m.awayTeam.name}`);
  } else if (tip === 'OVER_25') {
    bullets.push('Se espera un partido con varios goles');
  } else if (tip === 'UNDER_25') {
    bullets.push('Se espera un partido con pocos goles');
  } else if (tip === 'BTTS_YES') {
    bullets.push('Ambos equipos suelen anotar en sus partidos recientes');
  } else if (tip === 'BTTS_NO') {
    bullets.push('Al menos un equipo suele dejar la portería a cero');
  }
  if (bundle.dataQuality === 'low') {
    bullets.push('Pocos partidos recientes: toma la tip con cautela');
  }
  return bullets.slice(0, 4);
}

function alsoConsider(p) {
  const markets = [
    { code: 'HOME_WIN', prob: p.home_win_prob },
    { code: 'DRAW', prob: p.draw_prob },
    { code: 'AWAY_WIN', prob: p.away_win_prob },
    { code: 'OVER_15', prob: p.over15_prob },
    { code: 'UNDER_15', prob: p.under15_prob },
    { code: 'OVER_25', prob: p.over25_prob },
    { code: 'UNDER_25', prob: p.under25_prob },
    { code: 'OVER_35', prob: p.over35_prob },
    { code: 'UNDER_35', prob: p.under35_prob },
    { code: 'BTTS_YES', prob: p.btts_yes_prob },
    { code: 'BTTS_NO', prob: p.btts_no_prob },
  ];
  if (p.corners_over95_prob != null) {
    markets.push(
      { code: 'CORNERS_OVER_95', prob: p.corners_over95_prob },
      { code: 'CORNERS_UNDER_95', prob: p.corners_under95_prob }
    );
  }
  const primary = p.suggested_bet;
  const secondary = p.secondary_bet;
  const sorted = markets
    .filter((x) => x.prob != null && x.code !== primary)
    .sort((a, b) => Number(b.prob) - Number(a.prob));

  const out = [];
  if (secondary) {
    const sec = markets.find((x) => x.code === secondary);
    out.push({
      code: secondary,
      prob: sec ? sec.prob : null,
      value: p.value_market === secondary ? p.value_edge : null,
    });
  }
  for (const mkt of sorted) {
    if (out.length >= 3) break;
    if (out.some((o) => o.code === mkt.code)) continue;
    out.push({
      code: mkt.code,
      prob: mkt.prob,
      value: p.value_market === mkt.code ? p.value_edge : null,
    });
  }
  return out.slice(0, 3);
}

/** Parse match_date stored as UTC → Europe/Madrid parts. */
function parseMatchDate(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(' ', 'T');
  const iso = /Z|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatMatchWhen(value) {
  const d = parseMatchDate(value);
  if (!d) return String(value || '—');
  const datePart = d.toLocaleDateString('es-ES', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString('es-ES', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${datePart} · ${timePart}`;
}

function formatMatchDateOnly(value) {
  const d = parseMatchDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('es-ES', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatMatchTimeOnly(value) {
  const d = parseMatchDate(value);
  if (!d) return '—';
  return d.toLocaleTimeString('es-ES', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function matchesUrl(leagueId = null) {
  const params = new URLSearchParams({ days: String(WINDOW_DAYS) });
  if (leagueId != null) params.set('leagueId', String(leagueId));
  return `/api/v1/matches/today?${params}`;
}

function header(statusLine = null) {
  console.clear();
  console.log(chalk.bold.green('\n  HOUDINI BET') + chalk.gray('  ·  terminal\n'));
  console.log(chalk.gray(`  Ahora: ${new Date().toLocaleString('es-ES', { timeZone: TZ })} · Horario España`));
  if (isRemote()) console.log(chalk.cyan(`  API: ${API_BASE}`));
  else console.log(chalk.gray('  Modo local MySQL'));
  if (statusLine) console.log(statusLine);
  console.log('');
}

function printMarketsCatalog() {
  console.log(chalk.bold('  CATÁLOGO DE MERCADOS'));
  console.log(chalk.gray('  Qué puede ofrecer Houdini (estado real del modelo)\n'));
  const table = new Table({
    head: [
      chalk.cyan('Familia'),
      chalk.cyan('Mercado'),
      chalk.cyan('Estado'),
      chalk.cyan('Notas'),
    ],
    colWidths: [16, 36, 16, 38],
    wordWrap: true,
    style: { head: [], border: [] },
  });
  table.push(
    [
      'Resultado 1X2',
      'Gana local · Empate · Gana visitante',
      chalk.green('Disponible'),
      'Poisson',
    ],
    [
      'Goles partido',
      'O/U 1.5 · 2.5 · 3.5 (suma ambos)',
      chalk.green('Disponible'),
      'Poisson — total del partido',
    ],
    [
      'Goles equipo',
      'Local/Visitante O/U 0.5 · 1.5',
      chalk.green('Disponible'),
      'Solo goles de ese equipo',
    ],
    [
      'Goles',
      'Ambos marcan — Sí · No',
      chalk.green('Disponible'),
      'Poisson (BTTS)',
    ],
    [
      'Corners',
      'O/U 8.5 · 9.5 · 10.5 (partido)',
      chalk.yellow('Con API key'),
      'Stats API-Football tras sync',
    ],
    [
      'Tarjetas',
      'Amarillas O/U 3.5 · 4.5 (partido)',
      chalk.yellow('Con API key'),
      'Stats + faltas/rojas si hay',
    ]
  );
  console.log(table.toString());
  console.log('');
}

function printStaticMainMenu() {
  console.log(chalk.bold('  MENÚ PRINCIPAL'));
  console.log(chalk.gray('  ────────────────────────────────────────────'));
  const items = [
    ['Partidos próximos', 'Calendario real próximos 14 días (horario España)'],
    ['Mejores apuestas', 'Tips con confianza ≥60% en la ventana'],
    ['Apuestas con value', 'Solo selecciones con ventaja ≥5% vs cuota'],
    ['Combos', 'Elige 1–10 selecciones · value → confianza'],
    ['Buscar equipo', 'Forma reciente y próximo partido del equipo'],
    ['Analizar partido', 'Tip + tabla de todos los mercados del partido'],
    ['Filtrar por liga', 'Listado de partidos de una competición'],
    ['Estado / fuente de datos', 'LIVE/DEMO, odds, sync'],
    ['Sincronizar ahora', 'Actualiza fixtures e historial ahora'],
    ['Salir', 'Cierra la terminal de Houdini'],
  ];
  for (const [title, desc] of items) {
    console.log(`  ${chalk.white.bold(title)}`);
    console.log(chalk.gray(`     ${desc}`));
  }
  console.log(chalk.gray('  ────────────────────────────────────────────\n'));
}

async function fetchStatus() {
  if (!isRemote()) return null;
  try {
    return await remoteJson('/api/v1/status');
  } catch (_) {
    return null;
  }
}

async function headerWithStatus() {
  const st = await fetchStatus();
  let line = null;
  if (st) {
    const mode = st.demo ? chalk.yellow('DEMO') : chalk.green('LIVE');
    const sync = st.lastSyncAt
      ? new Date(st.lastSyncAt).toLocaleString('es-ES', { timeZone: TZ })
      : '—';
    line = chalk.gray(
      `  ${mode} · ${st.source || '?'} · ${st.fixtureDownloadCount ?? '?'} partidos · sync ${sync}`
    );
    if (st.syncing) line += chalk.yellow(' · actualizando…');
  }
  header(line);
  return st;
}

async function ensureTodayPredictions() {
  if (isRemote()) return;
  const ids = await matchModel.getScheduledTodayIds();
  for (const id of ids) {
    try {
      await predictionService.getPredictionBundle(id);
    } catch (_) {
      /* ignore */
    }
  }
}

async function loadUpcoming(leagueId = null) {
  if (isRemote()) {
    const data = await remoteJson(matchesUrl(leagueId));
    return data.matches || [];
  }
  await ensureTodayPredictions();
  return matchModel.getToday(leagueId);
}

async function loadBestBetsRaw() {
  if (isRemote()) {
    const data = await remoteJson(`/api/v1/matches/best-bets?days=${WINDOW_DAYS}&limit=40`);
    return (data.bets || []).map((b) => ({
      match_id: b.matchId,
      home_name: b.homeTeam.name,
      away_name: b.awayTeam.name,
      league_name: b.league,
      match_date: b.matchDate,
      suggested_bet: b.suggestedBet,
      secondary_bet: b.secondaryBet,
      confidence_score: b.confidenceScore,
      value_edge: b.valueEdge,
      value_market: b.valueMarket,
      home_win_prob: b.homeWinProb,
      draw_prob: b.drawProb,
      away_win_prob: b.awayWinProb,
      over15_prob: b.over15Prob,
      under15_prob: b.under15Prob,
      over25_prob: b.over25Prob,
      under25_prob: b.under25Prob,
      over35_prob: b.over35Prob,
      under35_prob: b.under35Prob,
      btts_yes_prob: b.bttsYesProb,
      btts_no_prob: b.bttsNoProb,
      corners_over95_prob: b.cornersOver95Prob,
      corners_under95_prob: b.cornersUnder95Prob,
      cards_over35_prob: b.cardsOver35Prob,
      cards_under35_prob: b.cardsUnder35Prob,
      cards_over45_prob: b.cardsOver45Prob,
      cards_under45_prob: b.cardsUnder45Prob,
    }));
  }
  await ensureTodayPredictions();
  const rows = await predictionService.getBestBets(40, WINDOW_DAYS);
  return rows.map((r) => ({
    match_id: r.match_id,
    home_name: r.home_name,
    away_name: r.away_name,
    league_name: r.league_name,
    match_date: r.match_date,
    suggested_bet: r.suggested_bet,
    secondary_bet: r.secondary_bet,
    confidence_score: Number(r.confidence_score),
    value_edge: r.value_edge != null ? Number(r.value_edge) : null,
    value_market: r.value_market,
    home_win_prob: r.home_win_prob != null ? Number(r.home_win_prob) : null,
    draw_prob: r.draw_prob != null ? Number(r.draw_prob) : null,
    away_win_prob: r.away_win_prob != null ? Number(r.away_win_prob) : null,
    over25_prob: r.over25_prob != null ? Number(r.over25_prob) : null,
    under25_prob: r.under25_prob != null ? Number(r.under25_prob) : null,
    btts_yes_prob: r.btts_yes_prob != null ? Number(r.btts_yes_prob) : null,
    btts_no_prob: r.btts_no_prob != null ? Number(r.btts_no_prob) : null,
    corners_over95_prob: r.corners_over95_prob != null ? Number(r.corners_over95_prob) : null,
    corners_under95_prob: r.corners_under95_prob != null ? Number(r.corners_under95_prob) : null,
  }));
}

function printBetCard(b, i) {
  const when = b.match_date ? formatMatchWhen(b.match_date) : null;
  const badge = valueBadge(b.value_edge);
  console.log(chalk.bold(`  ${i + 1}. ${b.home_name} vs ${b.away_name}`));
  console.log(
    chalk.gray(`     ${b.league_name}${when ? ` · ${when}` : ''}`)
  );
  console.log(
    `     Tip: ${chalk.white.bold(labelBet(b.suggested_bet))}  ·  conf ${confColor(b.confidence_score)} ${confBar(b.confidence_score)}`
  );
  if (b.secondary_bet) {
    console.log(chalk.gray(`     También: ${labelBet(b.secondary_bet)}`));
  }
  if (badge) console.log(`     ${badge}`);
  console.log('');
}

async function showUpcoming(leagueId = null) {
  await headerWithStatus();
  const matches = await loadUpcoming(leagueId);
  if (!matches.length) {
    console.log(chalk.yellow(`  No hay partidos en los próximos ${WINDOW_DAYS} días.\n`));
    console.log(chalk.gray('  Prueba Sync o revisa API_BASE_URL.\n'));
    return;
  }
  console.log(chalk.bold(`  PARTIDOS (próx. ${WINDOW_DAYS} días) · Horario España\n`));
  const table = new Table({
    head: ['#', 'Día / Fecha', 'Hora', 'Local', 'Visitante', 'Liga', 'Tip', 'Error'].map((h) =>
      chalk.cyan(h)
    ),
    style: { compact: true },
    colWidths: [4, 14, 7, 18, 18, 14, 18, 8],
    wordWrap: true,
  });
  matches.forEach((m, i) => {
    const tip = m.suggestedBet || m.suggested_bet;
    const conf = m.confidenceScore ?? m.confidence_score;
    let tipCell = tip
      ? `${chalk.white.bold(shortLabelBet(tip))}  ${confColor(conf)}`
      : chalk.gray('—');
    if (m.status === 'live') tipCell = `${chalk.red('LIVE')} ${tipCell}`;
    const edge = m.valueEdge ?? m.value_edge;
    const valueCell =
      edge != null ? chalk.green(`+${Math.round(Number(edge) * 100)}%`) : chalk.gray('—');
    table.push([
      i + 1,
      formatMatchDateOnly(m.matchDate),
      formatMatchTimeOnly(m.matchDate),
      m.homeTeam.name,
      m.awayTeam.name,
      m.leagueName,
      tipCell,
      valueCell,
    ]);
  });
  console.log(table.toString());
  console.log(
    chalk.gray(
      `\n  Total: ${matches.length}  ·  Hora España  ·  Error = error de cuota (≥5% vs bookie)\n`
    )
  );
}

async function showBestBets({ valueOnly = false } = {}) {
  await headerWithStatus();
  let bets = await loadBestBetsRaw();
  const minConf = valueOnly ? MIN_CONF : MIN_BEST_CONF;
  bets = bets.filter((b) => Number(b.confidence_score) >= minConf);
  if (valueOnly) {
    bets = bets.filter((b) => b.value_edge != null && Number(b.value_edge) >= MIN_VALUE);
    bets.sort((a, b) => Number(b.value_edge) - Number(a.value_edge));
  }
  if (!bets.length) {
    if (valueOnly) {
      console.log(
        chalk.yellow(
          `  No hay apuestas con value (≥5%) y confianza ≥${MIN_CONF}% en ${WINDOW_DAYS} días.\n`
        )
      );
      console.log(
        chalk.gray(
          '  Sin API_FOOTBALL_KEY no hay cuotas → no hay value. Configura el secret en Cloudflare.\n'
        )
      );
    } else {
      console.log(
        chalk.yellow(
          `  No hay tips con confianza ≥${MIN_BEST_CONF}% en ${WINDOW_DAYS} días.\n`
        )
      );
    }
    return;
  }
  console.log(
    chalk.bold(
      valueOnly
        ? `  APUESTAS CON VALUE (próx. ${WINDOW_DAYS} días)\n`
        : `  MEJORES APUESTAS · conf ≥${MIN_BEST_CONF}% (próx. ${WINDOW_DAYS} días)\n`
    )
  );
  bets.slice(0, valueOnly ? 10 : 20).forEach((b, i) => printBetCard(b, i));
}

function tipRole(code, p) {
  if (code === p.suggested_bet) return chalk.green('primario');
  if (code === p.secondary_bet) return chalk.cyan('secundario');
  return chalk.gray('—');
}

function printMatchMarketsTable(p, homeName = 'Local', awayName = 'Visitante') {
  const sections = [
    {
      title: 'Resultado 1X2',
      rows: [
        { code: 'HOME_WIN', prob: p.home_win_prob },
        { code: 'DRAW', prob: p.draw_prob },
        { code: 'AWAY_WIN', prob: p.away_win_prob },
      ],
    },
    {
      title: 'Goles del PARTIDO (suma local + visitante)',
      rows: [
        { code: 'OVER_15', prob: p.over15_prob },
        { code: 'UNDER_15', prob: p.under15_prob },
        { code: 'OVER_25', prob: p.over25_prob },
        { code: 'UNDER_25', prob: p.under25_prob },
        { code: 'OVER_35', prob: p.over35_prob },
        { code: 'UNDER_35', prob: p.under35_prob },
      ],
    },
    {
      title: `Goles de ${homeName} (solo local)`,
      rows: [
        { code: 'HOME_OVER_05', prob: p.home_over05_prob },
        { code: 'HOME_UNDER_05', prob: p.home_under05_prob },
        { code: 'HOME_OVER_15', prob: p.home_over15_prob },
        { code: 'HOME_UNDER_15', prob: p.home_under15_prob },
      ],
    },
    {
      title: `Goles de ${awayName} (solo visitante)`,
      rows: [
        { code: 'AWAY_OVER_05', prob: p.away_over05_prob },
        { code: 'AWAY_UNDER_05', prob: p.away_under05_prob },
        { code: 'AWAY_OVER_15', prob: p.away_over15_prob },
        { code: 'AWAY_UNDER_15', prob: p.away_under15_prob },
      ],
    },
    {
      title: 'Ambos marcan',
      rows: [
        { code: 'BTTS_YES', prob: p.btts_yes_prob },
        { code: 'BTTS_NO', prob: p.btts_no_prob },
      ],
    },
    {
      title: 'Corners del partido',
      rows: [
        { code: 'CORNERS_OVER_85', prob: p.corners_over85_prob },
        { code: 'CORNERS_UNDER_85', prob: p.corners_under85_prob },
        { code: 'CORNERS_OVER_95', prob: p.corners_over95_prob },
        { code: 'CORNERS_UNDER_95', prob: p.corners_under95_prob },
        { code: 'CORNERS_OVER_105', prob: p.corners_over105_prob },
        { code: 'CORNERS_UNDER_105', prob: p.corners_under105_prob },
      ],
    },
    {
      title: 'Amarillas del partido',
      rows: [
        { code: 'CARDS_OVER_35', prob: p.cards_over35_prob },
        { code: 'CARDS_UNDER_35', prob: p.cards_under35_prob },
        { code: 'CARDS_OVER_45', prob: p.cards_over45_prob },
        { code: 'CARDS_UNDER_45', prob: p.cards_under45_prob },
      ],
    },
  ];

  console.log(chalk.bold('\n  TODOS LOS MERCADOS\n'));
  for (const section of sections) {
    console.log(chalk.cyan(`  ${section.title}`));
    const table = new Table({
      head: [chalk.cyan('Mercado'), chalk.cyan('Prob.'), chalk.cyan('Tip')],
      colWidths: [36, 10, 14],
      style: { head: [], border: [] },
    });
    for (const row of section.rows) {
      table.push([labelBet(row.code), pctWhole(row.prob), tipRole(row.code, p)]);
    }
    console.log(table.toString());
  }
  if (p.corners_over95_prob == null) {
    console.log(chalk.gray('  Corners: sin datos (pon API_FOOTBALL_KEY y Sync).'));
  }
  if (p.cards_over35_prob == null) {
    console.log(chalk.gray('  Amarillas: sin datos (pon API_FOOTBALL_KEY y Sync).'));
  }
  if (p.home_over05_prob == null) {
    console.log(chalk.gray('  Goles por equipo: vuelve a analizar el partido (predicción actualizada).'));
  }
}

function tipMarketProb(p) {
  const map = {
    HOME_WIN: p.home_win_prob,
    DRAW: p.draw_prob,
    AWAY_WIN: p.away_win_prob,
    OVER_15: p.over15_prob,
    UNDER_15: p.under15_prob,
    OVER_25: p.over25_prob,
    UNDER_25: p.under25_prob,
    OVER_35: p.over35_prob,
    UNDER_35: p.under35_prob,
    BTTS_YES: p.btts_yes_prob,
    BTTS_NO: p.btts_no_prob,
    HOME_OVER_05: p.home_over05_prob,
    HOME_UNDER_05: p.home_under05_prob,
    HOME_OVER_15: p.home_over15_prob,
    HOME_UNDER_15: p.home_under15_prob,
    AWAY_OVER_05: p.away_over05_prob,
    AWAY_UNDER_05: p.away_under05_prob,
    AWAY_OVER_15: p.away_over15_prob,
    AWAY_UNDER_15: p.away_under15_prob,
    CORNERS_OVER_85: p.corners_over85_prob,
    CORNERS_UNDER_85: p.corners_under85_prob,
    CORNERS_OVER_95: p.corners_over95_prob,
    CORNERS_UNDER_95: p.corners_under95_prob,
    CORNERS_OVER_105: p.corners_over105_prob,
    CORNERS_UNDER_105: p.corners_under105_prob,
    CARDS_OVER_35: p.cards_over35_prob,
    CARDS_UNDER_35: p.cards_under35_prob,
    CARDS_OVER_45: p.cards_over45_prob,
    CARDS_UNDER_45: p.cards_under45_prob,
  };
  const raw = map[p.suggested_bet];
  if (raw != null) {
    const n = Number(raw);
    return n <= 1 ? n * 100 : n;
  }
  return Number(p.confidence_score) || 0;
}

function printPrediction(bundle) {
  const p = bundle.prediction;
  const m = bundle.match;
  const tipConf = tipMarketProb(p);

  console.log(chalk.bold(`\n  ${m.homeTeam.name} vs ${m.awayTeam.name}`));
  console.log(chalk.gray(`  ${m.leagueName} · ${formatMatchWhen(m.matchDate)} · ${m.status}`));
  console.log(chalk.gray('  ─────────────────────────────────────────'));

  // Block A — Qué apostar
  console.log(chalk.bold.green('\n  HOUDINI SUGIERE\n'));
  console.log(`  ${chalk.white.bold(labelBet(p.suggested_bet))}`);
  console.log(`  ${confBar(tipConf)}  ${confColor(tipConf)} de confianza`);
  console.log(`  Riesgo: ${riskLabel(tipConf)}`);
  if (bundle.dataQuality === 'low') {
    console.log(chalk.yellow('  Pocos datos recientes — tip con cautela'));
  }
  const badge = valueBadge(p.value_edge);
  if (badge) {
    console.log(`  ${badge}`);
    if (p.value_market) {
      console.log(chalk.gray(`  Mercado con ventaja: ${labelBet(p.value_market)}`));
    }
    const odds = bundle.odds;
    if (odds) {
      const map = {
        HOME_WIN: odds.home_odds,
        DRAW: odds.draw_odds,
        AWAY_WIN: odds.away_odds,
        OVER_25: odds.over25_odds,
        UNDER_25: odds.under25_odds,
      };
      const q = map[p.value_market] ?? map[p.suggested_bet];
      if (q) console.log(chalk.blueBright(`  Mejor cuota disponible: ${q}`));
    }
  }
  console.log(chalk.gray('\n  ─────────────────────────────────────────'));

  if (bundle.recentAvgs) {
    const h = bundle.recentAvgs.home;
    const a = bundle.recentAvgs.away;
    console.log(chalk.bold('\n  PROMEDIOS RECIENTES (últimos partidos)\n'));
    console.log(
      chalk.gray(
        `  ${m.homeTeam.name}: corners ${h.corners ?? '—'} · amarillas ${h.yellows ?? '—'}`
      )
    );
    console.log(
      chalk.gray(
        `  ${m.awayTeam.name}: corners ${a.corners ?? '—'} · amarillas ${a.yellows ?? '—'}`
      )
    );
  }

  printMatchMarketsTable(p, m.homeTeam.name, m.awayTeam.name);
  console.log(chalk.gray('\n  ─────────────────────────────────────────'));

  // Block B — Por qué
  console.log(chalk.bold('\n  ¿POR QUÉ ESTA APUESTA?\n'));
  whyBullets(bundle).forEach((b) => console.log(chalk.gray(`  · ${b}`)));
  console.log(chalk.gray('\n  ─────────────────────────────────────────'));

  // Block C — Otras opciones
  console.log(chalk.bold('\n  TAMBIÉN CONSIDERA\n'));
  const extras = alsoConsider(p);
  if (!extras.length) {
    console.log(chalk.gray('  Sin alternativas claras.\n'));
  } else {
    extras.forEach((ex) => {
      const vb = valueBadge(ex.value);
      console.log(
        `  ${labelBet(ex.code).padEnd(28)} ${pctWhole(ex.prob)}  ${vb || chalk.gray('—')}`
      );
    });
    console.log('');
  }
}

async function analyzeMatch() {
  await headerWithStatus();
  const matches = await loadUpcoming();
  if (!matches.length) {
    console.log(chalk.yellow(`  No hay partidos en ${WINDOW_DAYS} días.\n`));
    return;
  }
  const { matchId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'matchId',
      message: 'Elige partido',
      pageSize: 20,
      choices: matches.map((m) => ({
        name: `${formatMatchWhen(m.matchDate)}  ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.leagueName})`,
        value: m.id,
      })),
    },
  ]);
  const bundle = isRemote()
    ? await remoteJson(`/api/v1/matches/${matchId}/prediction`)
    : await predictionService.getPredictionBundle(matchId);
  await headerWithStatus();
  printPrediction(bundle);
}

async function searchTeamFlow() {
  await headerWithStatus();
  const { q } = await inquirer.prompt([{ type: 'input', name: 'q', message: 'Buscar equipo:' }]);
  let teams;
  if (isRemote()) {
    teams = (await remoteJson(`/api/v1/teams/search?q=${encodeURIComponent(q.trim())}`)).teams || [];
  } else {
    teams = await teamModel.searchByName(q.trim());
  }
  if (!teams.length) {
    console.log(chalk.yellow('\n  Sin resultados.\n'));
    return;
  }
  const { teamId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'teamId',
      message: 'Selecciona',
      choices: teams.map((t) => ({
        name: `${t.name} (${t.league_name})`,
        value: t.id,
      })),
    },
  ]);
  await headerWithStatus();
  if (isRemote()) {
    const insight = await remoteJson(`/api/v1/teams/${teamId}`);
    console.log(chalk.bold(`  ${insight.team.name}`) + chalk.gray(`  · ${insight.team.league_name}`));
    console.log(`  Forma reciente: ${formBadges(insight.form)}\n`);
    if (!insight.nextMatch) {
      console.log(chalk.yellow('  Sin próximo partido sincronizado.\n'));
      return;
    }
    console.log(
      chalk.gray(
        `  Próximo: ${insight.nextMatch.homeTeam.name} vs ${insight.nextMatch.awayTeam.name} · ${formatMatchWhen(insight.nextMatch.matchDate)}\n`
      )
    );
    if (insight.prediction && insight.prediction.prediction) {
      printPrediction(insight.prediction);
    } else if (insight.prediction && insight.prediction.suggested_bet) {
      printPrediction({
        match: insight.nextMatch,
        prediction: insight.prediction,
        form: { home: insight.form, away: [] },
      });
    } else {
      const bundle = await remoteJson(`/api/v1/matches/${insight.nextMatch.id}/prediction`);
      printPrediction(bundle);
    }
    return;
  }
  const team = await teamModel.findById(teamId);
  const stats = await teamStats.lastNForTeam(teamId, 5);
  const next = await matchModel.getNextForTeam(teamId);
  console.log(chalk.bold(`  ${team.name}`) + chalk.gray(`  · ${team.league_name}`));
  console.log(`  Forma reciente: ${formBadges(teamStats.formFromStats(stats))}\n`);
  if (!next) {
    console.log(chalk.yellow('  Sin próximo partido sincronizado en DB.\n'));
    return;
  }
  console.log(
    chalk.gray(
      `  Próximo: ${next.homeTeam.name} vs ${next.awayTeam.name} · ${formatMatchWhen(next.matchDate)}`
    )
  );
  const bundle = await predictionService.getPredictionBundle(next.id);
  printPrediction(bundle);
}

async function filterByLeague() {
  await headerWithStatus();
  const leagues = isRemote()
    ? (await remoteJson('/api/v1/leagues')).leagues
    : await leagueModel.listAll();
  const { leagueId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'leagueId',
      message: 'Liga',
      choices: [
        { name: 'Todas', value: null },
        ...leagues.map((l) => ({ name: `${l.name} (${l.country})`, value: l.id })),
      ],
    },
  ]);
  await showUpcoming(leagueId);
}

async function showStatus() {
  await headerWithStatus();
  if (!isRemote()) {
    console.log(chalk.yellow('  Modo local MySQL — no hay estado remoto.\n'));
    console.log(chalk.gray('  Usa HOUDINI_LOCAL=1 solo para MySQL; por defecto el CLI llama al Worker.\n'));
    return;
  }
  const st = await remoteJson('/api/v1/status');
  const table = new Table({ head: [chalk.cyan('Campo'), chalk.cyan('Valor')] });
  table.push(
    ['Fecha', st.date],
    ['Modo', st.mode],
    ['Fuente', st.source],
    ['Odds', st.oddsEnabled ? `ON · ${st.oddsMatchCount ?? 0} partidos` : 'OFF (sin API_FOOTBALL_KEY)'],
    ['Corners (stats)', String(st.cornersMatchCount ?? 0)],
    ['Amarillas (stats)', String(st.yellowsMatchCount ?? 0)],
    ['Ventana', `${st.windowDays} días`],
    ['Partidos', String(st.fixtureDownloadCount)],
    [
      'Último sync',
      st.lastSyncAt
        ? new Date(st.lastSyncAt).toLocaleString('es-ES', { timeZone: TZ })
        : '—',
    ],
    ['Mensaje', st.message || '—']
  );
  console.log(table.toString());
  console.log('');
}

async function runSync() {
  await headerWithStatus();
  console.log(chalk.cyan('  Sincronizando calendario e historial…\n'));
  if (isRemote()) {
    const secret = process.env.SYNC_SECRET || 'change-me-houdini';
    const result = await remoteJson('/api/v1/sync/manual', {
      method: 'POST',
      headers: { 'x-sync-secret': secret },
    });
    console.log(chalk.green('  Sync OK'));
    console.log(
      chalk.gray(
        `  modo=${result.mode} próximos=${result.savedFixtures} historial=${result.savedHistory}` +
          (result.oddsSynced != null ? ` odds=${result.oddsSynced}` : '') +
          (result.statsSynced != null ? ` stats=${result.statsSynced}` : '') +
          (result.internationalsSynced != null ? ` intl=${result.internationalsSynced}` : '') +
          (result.predicted != null ? ` predicted=${result.predicted}` : '')
      )
    );
    console.log('');
    return;
  }
  const result = await syncService.runDailySync();
  console.log(chalk.green('  Sync terminado:'), result);
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-8);
    console.log(chalk.gray('\n  Últimas líneas sync.log:'));
    lines.forEach((l) => console.log(chalk.gray(`  ${l}`)));
  }
  console.log('');
}

const COMBO_HINTS = {
  1: { text: 'Apuesta simple. Máxima probabilidad de acierto.', tone: 'green' },
  2: { text: 'Doble. Buena relación riesgo/beneficio.', tone: 'green' },
  3: { text: 'Triple. El combo más popular entre apostadores.', tone: 'green' },
  4: { text: 'Cuádruple. Riesgo moderado-alto.', tone: 'yellow' },
  5: { text: 'Quíntuple. El riesgo empieza a ser alto.', tone: 'yellow' },
  6: { text: 'Alto riesgo. Difícil de acertar.', tone: 'yellow' },
  7: { text: 'Muy alto riesgo. Solo para expertos.', tone: 'red' },
  8: { text: 'Riesgo extremo. Pocas veces se acierta.', tone: 'red' },
  9: { text: 'Riesgo extremo. Estadísticamente muy difícil.', tone: 'red' },
  10: {
    text: 'MÁXIMO RIESGO. La probabilidad de acertar todas es muy baja. Procede con precaución.',
    tone: 'red',
  },
};

function colorHint(hint) {
  if (hint.tone === 'green') return chalk.green(hint.text);
  if (hint.tone === 'yellow') return chalk.yellow(hint.text);
  return chalk.red(hint.text);
}

function toUnitProb(v) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n > 1 ? n / 100 : n;
}

function marketProbFromRow(row, code) {
  const map = {
    HOME_WIN: row.home_win_prob,
    DRAW: row.draw_prob,
    AWAY_WIN: row.away_win_prob,
    OVER_15: row.over15_prob,
    UNDER_15: row.under15_prob,
    OVER_25: row.over25_prob,
    UNDER_25: row.under25_prob,
    OVER_35: row.over35_prob,
    UNDER_35: row.under35_prob,
    BTTS_YES: row.btts_yes_prob,
    BTTS_NO: row.btts_no_prob,
    HOME_OVER_05: row.home_over05_prob,
    HOME_UNDER_05: row.home_under05_prob,
    HOME_OVER_15: row.home_over15_prob,
    HOME_UNDER_15: row.home_under15_prob,
    AWAY_OVER_05: row.away_over05_prob,
    AWAY_UNDER_05: row.away_under05_prob,
    AWAY_OVER_15: row.away_over15_prob,
    AWAY_UNDER_15: row.away_under15_prob,
    CORNERS_OVER_85: row.corners_over85_prob,
    CORNERS_UNDER_85: row.corners_under85_prob,
    CORNERS_OVER_95: row.corners_over95_prob,
    CORNERS_UNDER_95: row.corners_under95_prob,
    CORNERS_OVER_105: row.corners_over105_prob,
    CORNERS_UNDER_105: row.corners_under105_prob,
    CARDS_OVER_35: row.cards_over35_prob,
    CARDS_UNDER_35: row.cards_under35_prob,
    CARDS_OVER_45: row.cards_over45_prob,
    CARDS_UNDER_45: row.cards_under45_prob,
  };
  return toUnitProb(map[code]);
}

function rowToComboLeg(row) {
  const valueEdge = row.value_edge != null ? Number(row.value_edge) : null;
  const valueMarket = row.value_market || null;
  const suggested = row.suggested_bet;
  const hasValue = valueEdge != null && valueEdge >= MIN_VALUE && valueMarket;
  const bet = hasValue ? valueMarket : suggested;
  if (!bet) return null;
  let legProb = marketProbFromRow(row, bet);
  if (legProb == null) {
    legProb = toUnitProb(row.confidence_score);
  }
  if (legProb == null) return null;
  return {
    matchId: row.match_id,
    home: row.home_name,
    away: row.away_name,
    league: row.league_name,
    match_date: row.match_date,
    suggested_bet: bet,
    leg_prob: legProb,
    confidence_score: legProb * 100,
    value_edge: hasValue ? valueEdge : null,
    has_value: !!hasValue,
  };
}

async function loadComboCandidates() {
  process.stdout.write(chalk.gray('  Cargando mejores tips de la ventana…\n'));
  const rows = await loadBestBetsRaw();
  const candidates = [];
  for (const row of rows) {
    const leg = rowToComboLeg(row);
    if (!leg) continue;
    if (leg.leg_prob * 100 < MIN_CONF) continue;
    candidates.push(leg);
  }
  return candidates;
}

function buildCombo(candidates, n, excludeMatchIds = new Set(), rotate = 0) {
  let sorted = [...candidates].sort((a, b) => {
    const av = a.has_value ? 1 : 0;
    const bv = b.has_value ? 1 : 0;
    if (bv !== av) return bv - av;
    return b.leg_prob - a.leg_prob;
  });
  if (rotate > 0 && rotate < sorted.length) {
    sorted = [...sorted.slice(rotate), ...sorted.slice(0, rotate)];
  }
  const picked = [];
  const usedMatches = new Set();
  for (const c of sorted) {
    if (picked.length >= n) break;
    if (excludeMatchIds.has(c.matchId)) continue;
    if (usedMatches.has(c.matchId)) continue;
    usedMatches.add(c.matchId);
    picked.push(c);
  }
  return picked;
}

function uniqueMatchCount(candidates) {
  return new Set(candidates.map((c) => c.matchId)).size;
}

function comboSignature(picks) {
  return picks
    .map((p) => `${p.matchId}:${p.suggested_bet}`)
    .sort()
    .join('|');
}

function buildComboAlternative(candidates, n, previousPicks) {
  const exclude = new Set(previousPicks.map((p) => p.matchId));
  const target = Math.min(n, uniqueMatchCount(candidates));
  let picks = buildCombo(candidates, n, exclude, 0);
  if (picks.length >= target && comboSignature(picks) !== comboSignature(previousPicks)) {
    return picks;
  }
  for (let r = 1; r < candidates.length; r += 1) {
    picks = buildCombo(candidates, n, new Set(), r);
    if (picks.length && comboSignature(picks) !== comboSignature(previousPicks)) {
      return picks;
    }
  }
  return previousPicks;
}

function combinedProb(picks) {
  if (!picks.length) return 0;
  return picks.reduce((acc, p) => acc * Number(p.leg_prob), 1);
}

function comboOverallLabel(prob) {
  const pct = Math.round(prob * 100);
  if (pct > 40) return { label: 'ALTA', color: chalk.green, barColor: chalk.green };
  if (pct >= 25) return { label: 'MEDIA', color: chalk.yellow, barColor: chalk.yellow };
  return { label: 'ARRIESGADO', color: chalk.red, barColor: chalk.red };
}

function printComboCard(picks, nRequested, altNote = false) {
  const n = picks.length;
  console.log(chalk.bold(`\n  TU COMBO DE ${n} SELECCIONES`));
  console.log(chalk.gray('  Generado con la mejor combinación posible'));
  if (altNote) console.log(chalk.cyan('  Mostrando combinación alternativa'));
  if (n < nRequested) {
    console.log(
      chalk.yellow(
        `\n  Hoy solo hay ${n} apuestas con suficiente confianza (≥${MIN_CONF}%).`
      )
    );
    console.log(chalk.yellow(`  Te mostramos el mejor combo posible con ${n} selecciones.`));
  }
  console.log('');
  picks.forEach((p) => {
    const mark = p.has_value ? chalk.green('OK') : chalk.yellow('~');
    const valuePart = p.has_value
      ? chalk.green(`VALUE +${Math.round(p.value_edge * 100)}%`)
      : chalk.gray('Sin value');
    const pct = Math.round(p.leg_prob * 100);
    console.log(
      `  [${mark}] ${labelBet(p.suggested_bet).padEnd(22)} ${pct}% · ${valuePart}`
    );
    console.log(
      chalk.gray(`       ${p.home} vs ${p.away} · ${formatMatchWhen(p.match_date)}`)
    );
  });
  const prob = combinedProb(picks);
  const pct = Math.round(prob * 100);
  const overall = comboOverallLabel(prob);
  console.log('');
  console.log('  Probabilidad combinada estimada:');
  console.log(`  ${overall.barColor(confBar(pct))}  ${overall.color(`${pct}%`)}`);
  console.log(`  Confianza general: ${overall.color(overall.label)}`);
  console.log('');
}

async function askComboSize(defaultN = 3) {
  await headerWithStatus();
  console.log(chalk.bold('  ¿Cuántas apuestas quieres combinar?\n'));
  console.log(chalk.gray('  Elige entre 1 y 10 selecciones.\n'));
  console.log(chalk.gray('  Cuantas menos selecciones, más probabilidad de acertar el combo.'));
  console.log(chalk.yellow('  A partir de 5 selecciones el riesgo aumenta considerablemente.\n'));

  const { n } = await inquirer.prompt([
    {
      type: 'list',
      name: 'n',
      message: 'Número de selecciones',
      default: defaultN,
      pageSize: 10,
      choices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
        const hint = COMBO_HINTS[num];
        return {
          name: `${String(num).padStart(2, ' ')}  —  ${hint.text}`,
          value: num,
          short: String(num),
        };
      }),
    },
  ]);
  console.log(`\n  ${colorHint(COMBO_HINTS[n])}\n`);
  return n;
}

async function combosFlow() {
  let preferredN = 3;
  let candidates = null;
  let lastPicks = [];

  while (true) {
    const n = await askComboSize(preferredN);
    preferredN = n;

    if (!candidates) {
      await headerWithStatus();
      candidates = await loadComboCandidates();
    }

    if (!candidates.length) {
      console.log(
        chalk.yellow(
          `\n  No hay apuestas con confianza ≥${MIN_CONF}% en la ventana. Prueba Sync más tarde.\n`
        )
      );
      return;
    }

    let picks = buildCombo(candidates, n, new Set(), 0);
    lastPicks = picks;
    let altNote = false;

    while (true) {
      await headerWithStatus();
      printComboCard(picks, n, altNote);
      altNote = false;
      console.log(chalk.gray('  Inicia sesión para guardar — disponible en la web cuando haya cuenta.\n'));

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Combo',
          choices: [
            { name: '← Cambiar número de selecciones', value: 'change' },
            { name: 'Regenerar (misma cantidad, otra combinación)', value: 'regen' },
            { name: 'Volver al menú principal', value: 'back' },
          ],
        },
      ]);

      if (action === 'back') return;
      if (action === 'change') break;
      if (action === 'regen') {
        picks = buildComboAlternative(candidates, n, lastPicks);
        lastPicks = picks;
        altNote = true;
      }
    }
  }
}

async function mainMenu() {
  while (true) {
    await headerWithStatus();
    printMarketsCatalog();
    printStaticMainMenu();
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Elige opción',
        pageSize: 14,
        choices: [
          { name: 'Partidos próximos', value: 'upcoming' },
          { name: 'Mejores apuestas', value: 'best' },
          { name: 'Apuestas con value', value: 'value' },
          { name: 'Combos', value: 'combos' },
          { name: 'Buscar equipo', value: 'search' },
          { name: 'Analizar partido', value: 'analyze' },
          { name: 'Filtrar por liga', value: 'league' },
          { name: 'Estado / fuente de datos', value: 'status' },
          { name: 'Sincronizar ahora', value: 'sync' },
          { name: 'Salir', value: 'exit' },
        ],
      },
    ]);

    if (action === 'exit') {
      console.log(chalk.gray('\n  Hasta luego.\n'));
      process.exit(0);
    }
    try {
      if (action === 'upcoming') await showUpcoming();
      if (action === 'best') await showBestBets({ valueOnly: false });
      if (action === 'value') await showBestBets({ valueOnly: true });
      if (action === 'combos') await combosFlow();
      if (action === 'search') await searchTeamFlow();
      if (action === 'analyze') await analyzeMatch();
      if (action === 'league') await filterByLeague();
      if (action === 'status') await showStatus();
      if (action === 'sync') await runSync();
    } catch (err) {
      console.log(chalk.red(`\n  Error: ${err.message}\n`));
      if (err.code === 'ECONNREFUSED') {
        console.log(
          chalk.yellow(
            isRemote()
              ? '  No se pudo conectar a la API remota. Revisa API_BASE_URL.\n'
              : '  ¿MySQL está arrancado? Revisa DB_* en .env\n'
          )
        );
      }
    }
    if (action !== 'combos') {
      await inquirer.prompt([{ type: 'input', name: 'ok', message: 'Enter para volver al menú' }]);
    }
  }
}

mainMenu().catch((err) => {
  console.error(err);
  process.exit(1);
});
