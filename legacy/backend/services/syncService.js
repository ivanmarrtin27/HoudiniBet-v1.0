const { apiFootball, getLeagueIds, hasApiKey } = require('../config/apiFootball');
const leagueModel = require('../models/league');
const teamModel = require('../models/team');
const matchModel = require('../models/match');
const teamStats = require('../models/teamStats');
const predictionModel = require('../models/prediction');
const predictionService = require('./predictionService');
const { logSync } = require('./logger');

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function mapStatus(short) {
  if (!short) return 'scheduled';
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished';
  if (['1H', '2H', 'ET', 'BT', 'P', 'LIVE', 'HT'].includes(short)) return 'live';
  return 'scheduled';
}

async function upsertTeamsAndLeague(item) {
  const leagueId = await leagueModel.upsertByApiId({
    name: item.league.name,
    country: item.league.country,
    logo_url: item.league.logo,
    api_id: item.league.id,
  });
  const homeId = await teamModel.upsertByApiId({
    name: item.teams.home.name,
    logo_url: item.teams.home.logo,
    league_id: leagueId,
    api_id: item.teams.home.id,
  });
  const awayId = await teamModel.upsertByApiId({
    name: item.teams.away.name,
    logo_url: item.teams.away.logo,
    league_id: leagueId,
    api_id: item.teams.away.id,
  });
  return { leagueId, homeId, awayId };
}

async function fetchFixtures({ date, status, league }) {
  const params = { date, league };
  if (status) params.status = status;
  const { data } = await apiFootball.get('/fixtures', { params });
  return data.response || [];
}

async function saveFixture(item) {
  const { leagueId, homeId, awayId } = await upsertTeamsAndLeague(item);
  const status = mapStatus(item.fixture.status.short);
  const matchId = await matchModel.upsertFixture({
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
    await teamStats.upsertStat({
      team_id: homeId,
      match_id: matchId,
      goals_scored: item.goals.home,
      goals_conceded: item.goals.away,
      corners_for: null,
      corners_against: null,
      is_home: true,
      match_date: matchDate,
    });
    await teamStats.upsertStat({
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

async function syncOddsForMatch(apiFixtureId, localMatchId) {
  try {
    const { data } = await apiFootball.get('/odds', {
      params: { fixture: apiFixtureId },
    });
    const book = (data.response || [])[0];
    if (!book) return;
    const bets = book.bookmakers?.[0]?.bets || [];
    const matchWinner = bets.find((b) => b.name === 'Match Winner');
    const overUnder = bets.find((b) => b.name === 'Goals Over/Under');
    const home = matchWinner?.values?.find((v) => v.value === 'Home');
    const draw = matchWinner?.values?.find((v) => v.value === 'Draw');
    const away = matchWinner?.values?.find((v) => v.value === 'Away');
    const over = overUnder?.values?.find((v) => String(v.value).includes('Over 2.5'));
    const under = overUnder?.values?.find((v) => String(v.value).includes('Under 2.5'));
    await predictionModel.upsertOdds({
      match_id: localMatchId,
      bookmaker: book.bookmakers?.[0]?.name || 'avg',
      home_odds: home ? Number(home.odd) : null,
      draw_odds: draw ? Number(draw.odd) : null,
      away_odds: away ? Number(away.odd) : null,
      over25_odds: over ? Number(over.odd) : null,
      under25_odds: under ? Number(under.odd) : null,
    });
  } catch (err) {
    logSync(`Odds skip fixture ${apiFixtureId}: ${err.message}`);
  }
}

async function runDailySync() {
  if (!hasApiKey()) {
    logSync('SYNC omitido: no hay API_FOOTBALL_KEY. Usa datos demo / seed.');
    const ids = await matchModel.getScheduledTodayIds();
    if (ids.length) {
      logSync(`Calculando predicciones demo para ${ids.length} partidos de hoy...`);
      await predictionService.predictMany(ids);
    }
    return { ok: true, mode: 'demo', predicted: ids.length };
  }

  const leagues = getLeagueIds();
  const today = formatDate(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = formatDate(yesterdayDate);

  logSync(`Inicio sync — hoy=${today} ayer=${yesterday} ligas=${leagues.join(',')}`);

  let savedToday = 0;
  let savedYday = 0;
  const todayMatchIds = [];

  for (const league of leagues) {
    try {
      const todayFixtures = await fetchFixtures({ date: today, league });
      for (const item of todayFixtures) {
        const id = await saveFixture(item);
        todayMatchIds.push(id);
        savedToday += 1;
        if (mapStatus(item.fixture.status.short) === 'scheduled') {
          await syncOddsForMatch(item.fixture.id, id);
        }
      }
      const ydayFixtures = await fetchFixtures({ date: yesterday, status: 'FT', league });
      for (const item of ydayFixtures) {
        await saveFixture(item);
        savedYday += 1;
      }
      logSync(`Liga ${league}: hoy=${todayFixtures.length} ayerFT=${ydayFixtures.length}`);
    } catch (err) {
      logSync(`Error liga ${league}: ${err.message}`);
    }
  }

  const uniqueIds = [...new Set(todayMatchIds)];
  logSync(`Predicciones para ${uniqueIds.length} partidos de hoy...`);
  await predictionService.predictMany(uniqueIds);
  logSync(`Sync OK — guardados hoy=${savedToday} ayer=${savedYday}`);

  return { ok: true, mode: 'api', savedToday, savedYday, predicted: uniqueIds.length };
}

module.exports = { runDailySync };
