require('dotenv').config();

const config = {
  port: parseInt(process.env.ENRICHMENT_SERVICE_PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Enrichment provider
  provider: {
    name: process.env.ENRICHMENT_PROVIDER || 'none',
    apiKey: process.env.ENRICHMENT_PROVIDER_API_KEY,
    endpoint: process.env.ENRICHMENT_PROVIDER_ENDPOINT,
    timeoutMs: parseInt(process.env.ENRICHMENT_PROVIDER_TIMEOUT_MS, 10) || 10000,
  },

  // Auth
  enrichmentToken: process.env.ATS_ENRICHMENT_TOKEN,

  // Rate limiting
  rateLimits: {
    perUserPerDay: parseInt(process.env.RATE_LIMIT_PER_USER_PER_DAY, 10) || 60,
    globalPerDay: parseInt(process.env.RATE_LIMIT_GLOBAL_PER_DAY, 10) || 500,
    candidateCooldownDays: parseInt(process.env.CANDIDATE_COOLDOWN_DAYS, 10) || 7,
  },

  // Cost controls
  dailyCostCapUsd: parseFloat(process.env.DAILY_COST_CAP_USD) || 50,
};

module.exports = config;
