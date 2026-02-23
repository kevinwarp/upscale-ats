const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-user rate limit (keyed on X-User-Id header).
 */
const perUserLimiter = rateLimit({
  windowMs: ONE_DAY_MS,
  max: config.rateLimits.perUserPerDay,
  keyGenerator: (req) => req.headers['x-user-id'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Per-user rate limit exceeded', {
      userId: req.headers['x-user-id'],
    });
    res.status(429).json({
      error: 'Per-user daily enrichment limit reached',
      limit: config.rateLimits.perUserPerDay,
    });
  },
});

/**
 * Global rate limit across all users.
 */
const globalLimiter = rateLimit({
  windowMs: ONE_DAY_MS,
  max: config.rateLimits.globalPerDay,
  keyGenerator: () => 'global',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    logger.warn('Global rate limit exceeded');
    res.status(429).json({
      error: 'Global daily enrichment limit reached',
      limit: config.rateLimits.globalPerDay,
    });
  },
});

/**
 * In-memory candidate cooldown cache.
 * Maps candidateId -> timestamp of last enrichment.
 * TODO: Replace with Redis for multi-instance deployments (Phase 2).
 */
const candidateCooldownCache = new Map();

function candidateCooldown(req, res, next) {
  const candidateId = req.body.candidate_id;
  if (!candidateId) return next();

  const lastEnriched = candidateCooldownCache.get(candidateId);
  if (lastEnriched) {
    const cooldownMs = config.rateLimits.candidateCooldownDays * ONE_DAY_MS;
    const elapsed = Date.now() - lastEnriched;

    if (elapsed < cooldownMs) {
      const nextAvailable = new Date(lastEnriched + cooldownMs).toISOString();
      logger.info('Candidate cooldown active', { candidateId, nextAvailable });
      return res.status(429).json({
        error: 'Candidate was recently enriched',
        next_available: nextAvailable,
        cooldown_days: config.rateLimits.candidateCooldownDays,
      });
    }
  }

  next();
}

/**
 * Record a successful enrichment timestamp for cooldown tracking.
 */
function recordEnrichment(candidateId) {
  candidateCooldownCache.set(candidateId, Date.now());
}

// Expose for testing
function _clearCooldownCache() {
  candidateCooldownCache.clear();
}

module.exports = {
  perUserLimiter,
  globalLimiter,
  candidateCooldown,
  recordEnrichment,
  _clearCooldownCache,
};
