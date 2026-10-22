const teamModel = require('../models/team');
const matchModel = require('../models/match');
const teamStats = require('../models/teamStats');
const predictionService = require('../services/predictionService');

async function searchTeam(req, res) {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });
    const teams = await teamModel.searchByName(q);
    res.json({ teams });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function teamInsight(req, res) {
  try {
    const id = Number(req.params.id);
    const team = await teamModel.findById(id);
    if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });
    const stats = await teamStats.lastNForTeam(id, 5);
    const nextMatch = await matchModel.getNextForTeam(id);
    let prediction = null;
    if (nextMatch) {
      prediction = await predictionService.getPredictionBundle(nextMatch.id);
    }
    res.json({
      team,
      form: teamStats.formFromStats(stats),
      last5: stats,
      nextMatch,
      prediction,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { searchTeam, teamInsight };
