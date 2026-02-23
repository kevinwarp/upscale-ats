const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const logger = require('./utils/logger');
const authMiddleware = require('./middleware/auth');
const { perUserLimiter, globalLimiter } = require('./middleware/rateLimiter');
const { captureRawBody } = require('./middleware/slackVerify');
const enrichRouter = require('./routes/enrich');
const pipelineRouter = require('./routes/pipeline');
const candidatesRouter = require('./routes/candidates');
const feedbackRouter = require('./routes/feedback');
const calendarRouter = require('./routes/calendar');
const emailRouter = require('./routes/email');
const slackRouter = require('./routes/slackInteractions');
const analyticsRouter = require('./routes/analytics');
const reportService = require('./services/reportService');
const monitoringService = require('./services/monitoringService');
const feedbackReminder = require('./jobs/feedbackReminder');
const postInterviewCheck = require('./jobs/postInterviewCheck');
const calendarSyncJob = require('./jobs/calendarSyncJob');

const app = express();

// --- Global middleware ---
app.use(helmet());
app.use(cors());
app.use(express.json({ verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, verify: captureRawBody }));
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

// --- Unauthenticated: Slack interactions (verified by Slack signing secret) ---
app.use('/v1/slack', slackRouter);

// --- Authenticated + rate-limited routes ---
app.use('/v1/enrich', authMiddleware, globalLimiter, perUserLimiter, enrichRouter);
app.use('/v1/pipeline', authMiddleware, pipelineRouter);
app.use('/v1/candidates', authMiddleware, candidatesRouter);
app.use('/v1/analytics', authMiddleware, analyticsRouter);

// --- Email: webhook unauthenticated (Google Pub/Sub), rest authenticated ---
app.use('/v1/email', (req, res, next) => {
  if (req.path === '/webhook' && req.method === 'POST') return next();
  authMiddleware(req, res, next);
}, emailRouter);

// --- Calendar: webhook + OAuth callback unauthenticated, rest authenticated ---
app.use('/v1/calendar', (req, res, next) => {
  if ((req.path === '/webhook' && req.method === 'POST') ||
      (req.path === '/oauth/callback' && req.method === 'GET')) return next();
  authMiddleware(req, res, next);
}, calendarRouter);

// --- Reports endpoint ---
app.get('/v1/reports/:candidateId', authMiddleware, async (req, res) => {
  try {
    const candidateId = parseInt(req.params.candidateId);
    const jobId = req.query.job_id ? parseInt(req.query.job_id) : null;
    const report = await reportService.getReport(candidateId, jobId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err) {
    logger.error('Get report failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get report' });
  }
});

// --- Monitoring endpoint ---
app.get('/v1/monitoring/health', authMiddleware, async (_req, res) => {
  try {
    const metrics = await monitoringService.getHealthMetrics();
    res.json(metrics);
  } catch (err) {
    logger.error('Monitoring health failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get health metrics' });
  }
});

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
    calendarSyncJob.start();
  });
}

// Export for testing
module.exports = app;
