const matchModel = require('../models/match');
const leagueModel = require('../models/league');
const predictionService = require('../services/predictionService');
const syncService = require('../services/syncService');

async function today(req, res) {
  try {
    const leagueId = req.query.leagueId ? Number(req.query.leagueId) : null;
    const matches = await matchModel.getToday(leagueId);
    res.json({ date: new Date().toISOString().slice(0, 10), count: matches.length, matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function bestBets(req, res) {
  try {
    const rows = await predictionService.getBestBets(3);
    res.json({
      count: rows.length,
      bets: rows.map((r) => ({
        matchId: r.match_id,
        matchDate: r.match_date,
        league: r.league_name,
        homeTeam: { name: r.home_name, logo: r.home_logo },
        awayTeam: { name: r.away_name, logo: r.away_logo },
        suggestedBet: r.suggested_bet,
        secondaryBet: r.secondary_bet,
        confidenceScore: Number(r.confidence_score),
        highConfidence: Number(r.confidence_score) >= 60,
        valueEdge: r.value_edge != null ? Number(r.value_edge) : null,
        valueMarket: r.value_market,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function prediction(req, res) {
  try {
    const id = Number(req.params.id);
    const bundle = await predictionService.getPredictionBundle(id);
    res.json(bundle);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function leagues(_req, res) {
  try {
    res.json({ leagues: await leagueModel.listAll() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function manualSync(_req, res) {
  try {
    const result = await syncService.runDailySync();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { today, bestBets, prediction, leagues, manualSync };
