require('dotenv').config();

const config = {
  port: parseInt(process.env.ENRICHMENT_SERVICE_PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Clay.com API
  clay: {
    apiKey: process.env.CLAY_API_KEY,
    apiEndpoint: process.env.CLAY_API_ENDPOINT || 'https://api.clay.com/v1',
    workflowId: process.env.CLAY_WORKFLOW_ID,
    authMethod: process.env.CLAY_AUTH_METHOD || 'api_key',
    timeoutMs: 10000,
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
