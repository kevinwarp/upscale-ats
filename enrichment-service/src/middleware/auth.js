const config = require('../config');
const logger = require('../utils/logger');

/**
 * Verify Bearer token on incoming requests.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or malformed Authorization header', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7);

  if (token !== config.enrichmentToken) {
    logger.warn('Invalid enrichment token', { ip: req.ip, path: req.path });
    return res.status(403).json({ error: 'Invalid token' });
  }

  next();
}

module.exports = authMiddleware;
