require('dotenv').config();
const axios = require('axios');

const apiFootball = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: {
    'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
  },
  timeout: 30000,
});

function getLeagueIds() {
  return (process.env.LEAGUE_IDS || '140,141,39,135,78,61')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter(Boolean);
}

function hasApiKey() {
  return Boolean(process.env.API_FOOTBALL_KEY && process.env.API_FOOTBALL_KEY.trim());
}

module.exports = { apiFootball, getLeagueIds, hasApiKey };
