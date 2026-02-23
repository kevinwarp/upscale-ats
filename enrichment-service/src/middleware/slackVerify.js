const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

const SLACK_SIGNATURE_VERSION = 'v0';
const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

/**
 * Verify Slack request signatures.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * Must be used with raw body parsing (express.raw or express.urlencoded with verify).
 */
function slackVerify(req, res, next) {
  if (!config.slack.signingSecret) {
    logger.warn('Slack signing secret not configured, skipping verification');
    return next();
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSignature = req.headers['x-slack-signature'];

  if (!timestamp || !slackSignature) {
    return res.status(401).json({ error: 'Missing Slack signature headers' });
  }

  // Prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > MAX_TIMESTAMP_AGE_SECONDS) {
    return res.status(401).json({ error: 'Slack request timestamp too old' });
  }

  // Compute expected signature
  const rawBody = req.rawBody || '';
  const sigBaseString = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const expectedSignature = `${SLACK_SIGNATURE_VERSION}=` +
    crypto.createHmac('sha256', config.slack.signingSecret)
      .update(sigBaseString, 'utf8')
      .digest('hex');

  // Constant-time comparison
  if (!crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'utf8'),
    Buffer.from(slackSignature, 'utf8')
  )) {
    logger.warn('Slack signature verification failed');
    return res.status(401).json({ error: 'Invalid Slack signature' });
  }

  next();
}

/**
 * Express middleware to capture raw body for Slack signature verification.
 * Must be applied BEFORE json/urlencoded parsing on Slack routes.
 */
function captureRawBody(req, res, buf) {
  req.rawBody = buf.toString('utf8');
}

module.exports = slackVerify;
module.exports.captureRawBody = captureRawBody;
