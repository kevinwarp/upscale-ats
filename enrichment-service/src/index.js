const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const logger = require('./utils/logger');
const authMiddleware = require('./middleware/auth');
const { perUserLimiter, globalLimiter } = require('./middleware/rateLimiter');
const enrichRouter = require('./routes/enrich');

const app = express();

// --- Global middleware ---
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// --- Health check (unauthenticated) ---
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: 'ats-enrichment-service', timestamp: new Date().toISOString() });
});

// --- Authenticated + rate-limited routes ---
app.use('/v1/enrich', authMiddleware, globalLimiter, perUserLimiter, enrichRouter);

// --- 404 handler ---
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- Global error handler ---
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// --- Start server ---
if (require.main === module) {
  app.listen(config.port, () => {
    logger.info(`Enrichment service listening on port ${config.port}`, {
      env: config.nodeEnv,
    });
  });
}

// Export for testing
module.exports = app;
