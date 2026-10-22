require('dotenv').config();
const express = require('express');
const cors = require('cors');
const matchesRouter = require('./routes/matches');
const predictionsRouter = require('./routes/predictions');
const syncRouter = require('./routes/sync');
const { startDailySyncCron } = require('./cron/dailySync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'houdini-bet', ts: new Date().toISOString() });
});

app.use('/api/v1/matches', matchesRouter);
app.use('/api/v1', predictionsRouter);
app.use('/api/v1/sync', syncRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`Houdini Bet API en http://localhost:${PORT}`);
  startDailySyncCron();
});
