const cron = require('node-cron');
const syncService = require('../services/syncService');
const { logSync } = require('../services/logger');

function startDailySyncCron() {
  const expr = process.env.SYNC_CRON || '0 6 * * *';
  if (!cron.validate(expr)) {
    logSync(`Cron inválido: ${expr}`);
    return;
  }
  cron.schedule(expr, async () => {
    logSync('Cron diario disparado');
    try {
      await syncService.runDailySync();
    } catch (err) {
      logSync(`Cron error: ${err.message}`);
    }
  });
  logSync(`Cron programado: ${expr}`);
}

module.exports = { startDailySyncCron };
