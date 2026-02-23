const express = require('express');
const db = require('../db');
const gmailService = require('../services/gmailService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /v1/email/webhook
 * Gmail push notification receiver.
 * Google Pub/Sub sends a POST with base64-encoded data containing
 * the user's email and a historyId.
 *
 * This endpoint is unauthenticated (verified by Google Pub/Sub token).
 */
router.post('/webhook', async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message?.data) {
      return res.status(400).json({ error: 'Invalid push notification' });
    }

    // Decode Pub/Sub message
    const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
    const { emailAddress, historyId } = decoded;

    if (!emailAddress || !historyId) {
      return res.status(400).json({ error: 'Missing emailAddress or historyId' });
    }

    logger.info('Gmail push notification received', { emailAddress, historyId });

    // Find user by email
    const [users] = await db.query(
      'SELECT user_id FROM user WHERE email = ? LIMIT 1',
      [emailAddress]
    );

    if (users.length === 0) {
      logger.warn('Gmail push: no matching user', { emailAddress });
      return res.status(200).json({ status: 'ignored', reason: 'unknown_user' });
    }

    const userId = users[0].user_id;

    // Fetch new messages since historyId
    const messageIds = await gmailService.fetchHistorySince(userId, historyId);

    if (messageIds.length === 0) {
      return res.status(200).json({ status: 'ok', processed: 0 });
    }

    // Process each message (non-blocking)
    let processed = 0;
    for (const msgId of messageIds) {
      try {
        const parsed = await gmailService.fetchAndParseMessage(userId, msgId);
        if (parsed) {
          await gmailService.processEmail(parsed);
          processed++;
        }
      } catch (err) {
        logger.error('Failed to process Gmail message', { messageId: msgId, error: err.message });
      }
    }

    // Must respond 200 quickly to acknowledge Pub/Sub delivery
    res.status(200).json({ status: 'ok', processed });
  } catch (err) {
    logger.error('Gmail webhook error', { error: err.message });
    // Still return 200 to prevent Pub/Sub retries on application errors
    res.status(200).json({ status: 'error', error: err.message });
  }
});

/**
 * GET /v1/email/logs
 * Query email ingestion logs (authenticated).
 */
router.get('/logs', async (req, res) => {
  try {
    const { status, direction, candidate_id, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM email_ingestion_logs WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (direction) {
      query += ' AND direction = ?';
      params.push(direction);
    }
    if (candidate_id) {
      query += ' AND matched_candidate_id = ?';
      params.push(parseInt(candidate_id));
    }

    query += ' ORDER BY processed_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await db.query(query, params);

    // Count total
    let countQuery = 'SELECT COUNT(*) AS total FROM email_ingestion_logs WHERE 1=1';
    const countParams = [];
    if (status) { countQuery += ' AND status = ?'; countParams.push(status); }
    if (direction) { countQuery += ' AND direction = ?'; countParams.push(direction); }
    if (candidate_id) { countQuery += ' AND matched_candidate_id = ?'; countParams.push(parseInt(candidate_id)); }

    const [countRows] = await db.query(countQuery, countParams);

    res.json({
      logs: rows,
      total: countRows[0]?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    logger.error('Failed to get email logs', { error: err.message });
    res.status(500).json({ error: 'Failed to get email logs' });
  }
});

/**
 * POST /v1/email/watch
 * Set up Gmail watch for a user (authenticated, admin/recruiter).
 */
router.post('/watch', async (req, res) => {
  try {
    const userId = parseInt(req.headers['x-user-id']) || parseInt(req.body.user_id);
    if (!userId) {
      return res.status(400).json({ error: 'user_id required' });
    }

    const result = await gmailService.setupWatch(userId);
    res.json({ status: 'watching', ...result });
  } catch (err) {
    logger.error('Gmail watch setup failed', { error: err.message });
    res.status(500).json({ error: 'Failed to set up Gmail watch' });
  }
});

module.exports = router;
