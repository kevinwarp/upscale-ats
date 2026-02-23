const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const logger = require('./utils/logger');
const authMiddleware = require('./middleware/auth');
const { perUserLimiter, globalLimiter } = require('./middleware/rateLimiter');
const enrichRouter = require('./routes/enrich');
const pipelineRouter = require('./routes/pipeline');
const candidatesRouter = require('./routes/candidates');
const feedbackRouter = require('./routes/feedback');
const calendarRouter = require('./routes/calendar');
const feedbackReminder = require('./jobs/feedbackReminder');
const postInterviewCheck = require('./jobs/postInterviewCheck');

const app = express();

// --- Global middleware ---
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// --- Static files (feedback form) ---
app.use('/feedback', express.static(path.join(__dirname, 'public')));

// --- Health check (unauthenticated) ---
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: 'ats-enrichment-service', timestamp: new Date().toISOString() });
});

// --- Feedback form page (unauthenticated, token-based) ---
app.get('/feedback/:token', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feedback-form.html'));
});

// --- Unauthenticated feedback API routes (token-based access) ---
app.use('/v1/feedback', feedbackRouter);

// --- OAuth callback (unauthenticated — Google redirects here) ---
app.get('/v1/calendar/oauth/callback', calendarRouter);

// --- Authenticated + rate-limited routes ---
app.use('/v1/enrich', authMiddleware, globalLimiter, perUserLimiter, enrichRouter);
app.use('/v1/pipeline', authMiddleware, pipelineRouter);
app.use('/v1/candidates', authMiddleware, candidatesRouter);
app.use('/v1/calendar', authMiddleware, calendarRouter);

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

    // Start background jobs
    feedbackReminder.start();
    postInterviewCheck.start();
  });
}

// Export for testing
module.exports = app;
