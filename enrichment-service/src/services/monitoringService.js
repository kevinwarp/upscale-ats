const db = require('../db');
const logger = require('../utils/logger');

/**
 * Get comprehensive system health metrics.
 */
async function getHealthMetrics() {
  const [slackMetrics] = await db.query(`
    SELECT
      COUNT(*) AS total_messages,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM slack_messages
    WHERE sent_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
  `);

  const [emailMetrics] = await db.query(`
    SELECT
      COUNT(*) AS total_ingested,
      SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS processed,
      SUM(CASE WHEN status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
    FROM email_ingestion_logs
    WHERE processed_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
  `);

  const [feedbackMetrics] = await db.query(`
    SELECT
      COUNT(*) AS total_requested,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
      SUM(CASE WHEN status = 'draft' AND token_expires_at < NOW() THEN 1 ELSE 0 END) AS overdue,
      ROUND(SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
    FROM interview_feedback
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  `);

  const [workflowMetrics] = await db.query(`
    SELECT
      COUNT(*) AS total_events,
      SUM(CASE WHEN event_type = 'stage_transition' THEN 1 ELSE 0 END) AS stage_transitions,
      SUM(CASE WHEN event_type = 'report_generated' THEN 1 ELSE 0 END) AS reports_generated
    FROM workflow_events
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
  `);

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    metrics: {
      slack_24h: slackMetrics[0] || {},
      email_24h: emailMetrics[0] || {},
      feedback_7d: feedbackMetrics[0] || {},
      workflow_24h: workflowMetrics[0] || {},
    },
  };
}

module.exports = { getHealthMetrics };
