const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const feedbackService = require('./feedbackService');
const slackService = require('./slackService');
const workflowEngine = require('./workflowEngine');

// ============================================================================
// Report generation (Step 14)
// ============================================================================

/**
 * Check if all feedback is in for a candidate and generate report if so.
 * Called after each feedback submission.
 */
async function checkAndGenerate(candidateId, jobId = null) {
  const summary = await feedbackService.getFeedbackSummary(candidateId, jobId);

  if (summary.total_submitted === 0 || summary.total_submitted < summary.total_requested) {
    return null; // Not all feedback in yet
  }

  // Check if report already exists
  const [existing] = await db.query(
    'SELECT id FROM reports WHERE candidate_id = ? AND job_id <=> ? AND report_type = ?',
    [candidateId, jobId, 'onsite_summary']
  );

  if (existing.length > 0) {
    logger.debug('Report already exists', { candidateId, jobId });
    return null;
  }

  return generateReport(candidateId, jobId, summary);
}

/**
 * Generate a full structured report for a candidate.
 */
async function generateReport(candidateId, jobId, summary = null) {
  if (!summary) {
    summary = await feedbackService.getFeedbackSummary(candidateId, jobId);
  }

  // Get candidate info
  const [candidates] = await db.query(
    `SELECT candidate_id, CONCAT(first_name, ' ', last_name) AS name,
            email1 AS email, candidate_stage, phone_screen_score,
            onsite_avg_score, hire_recommendation
     FROM candidate WHERE candidate_id = ?`,
    [candidateId]
  );

  if (candidates.length === 0) {
    throw new Error('Candidate not found');
  }

  const candidate = candidates[0];

  // Build report
  const reportData = {
    candidate: {
      id: candidateId,
      name: candidate.name,
      email: candidate.email,
      stage: candidate.candidate_stage,
    },
    scores: {
      average: summary.overall_average,
      technical: summary.average_scores.technical,
      communication: summary.average_scores.communication,
      culture_fit: summary.average_scores.culture_fit,
      problem_solving: summary.average_scores.problem_solving,
    },
    recommendations: summary.recommendations,
    total_interviewers: summary.total_submitted,
    individual_feedback: summary.feedback.map((f) => ({
      interviewer: f.interviewer_name,
      scores: f.scores,
      recommendation: f.recommendation,
      notes: f.notes,
      submitted_at: f.submitted_at,
    })),
    recommendation: deriveRecommendation(summary),
    generated_at: new Date().toISOString(),
  };

  // Store report
  const [result] = await db.query(
    `INSERT INTO reports (candidate_id, job_id, report_type, report_data, delivery_status)
     VALUES (?, ?, 'onsite_summary', ?, 'pending')`,
    [candidateId, jobId, JSON.stringify(reportData)]
  );

  const reportId = result.insertId;

  // Update candidate onsite_avg_score and hire_recommendation
  await db.query(
    'UPDATE candidate SET onsite_avg_score = ?, hire_recommendation = ? WHERE candidate_id = ?',
    [summary.overall_average, reportData.recommendation, candidateId]
  );

  // Log workflow event
  await workflowEngine.logEvent({
    candidateId,
    jobId,
    eventType: 'report_generated',
    eventData: { reportId, avgScore: summary.overall_average },
    source: 'system',
  });

  // Deliver report (non-blocking)
  deliverReport(reportId, candidateId, jobId, candidate.name, reportData).catch((err) => {
    logger.error('Report delivery failed (non-fatal)', { error: err.message, reportId });
  });

  logger.info('Report generated', { reportId, candidateId, avgScore: summary.overall_average });

  return { report_id: reportId, ...reportData };
}

// ============================================================================
// Report delivery
// ============================================================================

async function deliverReport(reportId, candidateId, jobId, candidateName, reportData) {
  const deliveries = [];

  // Slack notification
  try {
    await slackService.notifyReportReady(
      candidateName,
      reportData.scores.average,
      candidateId,
      jobId
    );
    deliveries.push({ channel: 'slack', recipient: 'hiring_channel', status: 'sent' });
  } catch (err) {
    deliveries.push({ channel: 'slack', recipient: 'hiring_channel', status: 'failed', error: err.message });
  }

  // Email to hiring manager (via Gmail API — future enhancement)
  // For now, log as pending
  deliveries.push({ channel: 'email', recipient: 'hiring_manager', status: 'pending' });

  // Update delivery status
  const allSent = deliveries.every((d) => d.status === 'sent');
  const anyFailed = deliveries.some((d) => d.status === 'failed');
  const deliveryStatus = allSent ? 'delivered' : anyFailed ? 'partial' : 'pending';

  await db.query(
    'UPDATE reports SET delivered_to = ?, delivery_status = ? WHERE id = ?',
    [JSON.stringify(deliveries), deliveryStatus, reportId]
  );
}

// ============================================================================
// Report retrieval
// ============================================================================

/**
 * Get a report by candidate ID.
 */
async function getReport(candidateId, jobId = null) {
  let query = 'SELECT * FROM reports WHERE candidate_id = ?';
  const params = [candidateId];

  if (jobId) {
    query += ' AND job_id = ?';
    params.push(jobId);
  }

  query += ' ORDER BY generated_at DESC LIMIT 1';

  const [rows] = await db.query(query, params);
  if (rows.length === 0) return null;

  const report = rows[0];
  return {
    report_id: report.id,
    candidate_id: report.candidate_id,
    job_id: report.job_id,
    report_type: report.report_type,
    report_data: typeof report.report_data === 'string' ? JSON.parse(report.report_data) : report.report_data,
    generated_at: report.generated_at,
    delivered_to: typeof report.delivered_to === 'string' ? JSON.parse(report.delivered_to) : report.delivered_to,
    delivery_status: report.delivery_status,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive overall recommendation from feedback data.
 */
function deriveRecommendation(summary) {
  const { hire, no_hire } = summary.recommendations;
  const total = hire + no_hire + (summary.recommendations.maybe || 0);

  if (total === 0) return null;
  if (hire > total / 2) return summary.overall_average >= 4 ? 'strong_hire' : 'hire';
  if (no_hire > total / 2) return 'no_hire';
  return null; // Mixed — no recommendation
}

module.exports = {
  checkAndGenerate,
  generateReport,
  getReport,
  deriveRecommendation,
};
