require('dotenv').config();

const config = {
  port: parseInt(process.env.ENRICHMENT_SERVICE_PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'opencats',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'opencats',
  },

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

  // Slack integration
  slack: {
    feedbackWebhookUrl: process.env.SLACK_FEEDBACK_WEBHOOK_URL || '',
    feedbackChannel: process.env.SLACK_FEEDBACK_CHANNEL || '#hiring',
    botToken: process.env.SLACK_BOT_TOKEN || '',
  },

  // Feedback settings
  feedback: {
    reminderHours: parseInt(process.env.FEEDBACK_REMINDER_HOURS, 10) || 24,
    lockHours: parseInt(process.env.FEEDBACK_LOCK_HOURS, 10) || 48,
  },

  // Google Calendar
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  },

  // Pipeline
  pipeline: {
    staleThresholdDays: parseInt(process.env.STALE_THRESHOLD_DAYS, 10) || 7,
  },

  // App base URL (for generating links)
  baseUrl: process.env.APP_BASE_URL || 'http://localhost:8080',
};

module.exports = config;
