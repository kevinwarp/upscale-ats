const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Start the feedback reminder/lock job.
 * Runs every hour to check for overdue feedback.
 */
function start() {
  logger.info('Feedback reminder job started', {
    reminderHours: config.feedback.reminderHours,
    lockHours: config.feedback.lockHours,
  });

  setInterval(run, CHECK_INTERVAL_MS);
  // Run immediately on startup after a short delay
  setTimeout(run, 5000);
}

async function run() {
  try {
    await sendReminders();
    await lockExpired();
  } catch (err) {
    logger.error('Feedback reminder job error', { error: err.message });
  }
}

/**
 * Send reminders for feedback that is past the reminder threshold but not yet sent.
 */
async function sendReminders() {
  const reminderHours = config.feedback.reminderHours;

  const [rows] = await db.query(
    `SELECT id, interviewer_name, interviewer_email, candidate_name, access_token
     FROM interview_feedback
     WHERE status = 'draft'
       AND reminder_sent = FALSE
       AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
       AND token_expires_at > NOW()`,
    [reminderHours]
  );

  if (rows.length === 0) return;

  logger.info(`Sending ${rows.length} feedback reminders`);

  for (const row of rows) {
    await db.query(
      'UPDATE interview_feedback SET reminder_sent = TRUE WHERE id = ?',
      [row.id]
    );

    logger.info('Feedback reminder sent', {
      feedbackId: row.id,
      interviewer: row.interviewer_name,
      candidate: row.candidate_name,
    });

    // TODO: Send actual email/Slack DM reminder here
  }
}

/**
 * Lock feedback that has passed the expiration deadline.
 */
async function lockExpired() {
  const [result] = await db.query(
    `UPDATE interview_feedback
     SET status = 'locked', locked_at = NOW()
     WHERE status = 'draft'
       AND token_expires_at < NOW()`
  );

  if (result.affectedRows > 0) {
    logger.info(`Locked ${result.affectedRows} expired feedback requests`);
  }
}

module.exports = { start, run };
