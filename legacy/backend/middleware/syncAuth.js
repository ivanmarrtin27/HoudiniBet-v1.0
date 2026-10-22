module.exports = function syncAuth(req, res, next) {
  const secret = process.env.SYNC_SECRET || 'change-me-houdini';
  const header = req.header('x-sync-secret');
  if (!header || header !== secret) {
    return res.status(401).json({ error: 'No autorizado. Header x-sync-secret requerido.' });
  }
  return next();
};
