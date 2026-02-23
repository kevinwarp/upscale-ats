const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const slackService = require('./slackService');

/**
 * Create a feedback request for an interviewer.
 */
async function createFeedbackRequest({
  candidate_id, job_id, interviewer_user_id, interviewer_email,
  interviewer_name, candidate_name, job_title, event_id,
}) {
  const accessToken = crypto.randomBytes(32).toString('hex');
  const lockHours = config.feedback.lockHours;
  const expiresAt = new Date(Date.now() + lockHours * 3600 * 1000);

  const [result] = await db.query(
    `INSERT INTO interview_feedback
      (candidate_id, job_id, interviewer_user_id, interviewer_email, interviewer_name,
       candidate_name, job_title, event_id, access_token, token_expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      candidate_id, job_id || null, interviewer_user_id, interviewer_email || null,
      interviewer_name || null, candidate_name || null, job_title || null,
      event_id || null, accessToken, expiresAt,
    ]
  );

  const feedbackId = result.insertId;
  const formUrl = `${config.baseUrl}/feedback/${accessToken}`;

  logger.info('Feedback request created', { feedbackId, candidateId: candidate_id, interviewer: interviewer_name });

  return {
    feedback_id: feedbackId,
    access_token: accessToken,
    form_url: formUrl,
    expires_at: expiresAt.toISOString(),
  };
}

/**
 * Get feedback form data by token.
 */
async function getFeedbackByToken(token) {
  const [rows] = await db.query(
    `SELECT * FROM interview_feedback WHERE access_token = ?`,
    [token]
  );

  if (rows.length === 0) return null;

  const fb = rows[0];
  const isExpired = new Date(fb.token_expires_at) < new Date();

  return {
    feedback_id: fb.id,
    candidate_name: fb.candidate_name,
    job_title: fb.job_title,
    interviewer_name: fb.interviewer_name,
    status: isExpired && fb.status === 'draft' ? 'expired' : fb.status,
    scores: {
      technical: fb.score_technical,
      communication: fb.score_communication,
      culture_fit: fb.score_culture_fit,
      problem_solving: fb.score_problem_solving,
    },
    recommendation: fb.recommendation,
    notes: fb.notes || '',
    expires_at: fb.token_expires_at,
    is_expired: isExpired,
    candidate_id: fb.candidate_id,
    job_id: fb.job_id,
  };
}

/**
 * Save a draft (auto-save or explicit).
 */
async function saveDraft(token, { scores, recommendation, notes }) {
  const fb = await getFeedbackByToken(token);
  if (!fb) throw new Error('Feedback not found');
  if (fb.status !== 'draft') throw new Error('Feedback is not in draft status');
  if (fb.is_expired) throw new Error('Feedback window has expired');

  const updates = [];
  const params = [];

  if (scores) {
    if (scores.technical != null) { updates.push('score_technical = ?'); params.push(scores.technical); }
    if (scores.communication != null) { updates.push('score_communication = ?'); params.push(scores.communication); }
    if (scores.culture_fit != null) { updates.push('score_culture_fit = ?'); params.push(scores.culture_fit); }
    if (scores.problem_solving != null) { updates.push('score_problem_solving = ?'); params.push(scores.problem_solving); }
  }
  if (recommendation !== undefined) { updates.push('recommendation = ?'); params.push(recommendation); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

  if (updates.length === 0) return fb;

  params.push(token);
  await db.query(
    `UPDATE interview_feedback SET ${updates.join(', ')} WHERE access_token = ?`,
    params
  );

  return getFeedbackByToken(token);
}

/**
 * Submit feedback — validates, finalizes, posts to Slack.
 */
async function submitFeedback(token, { scores, recommendation, notes }) {
  const fb = await getFeedbackByToken(token);
  if (!fb) throw new Error('Feedback not found');
  if (fb.status !== 'draft') throw new Error('Feedback is not in draft status');
  if (fb.is_expired) throw new Error('Feedback window has expired');

  // Validate
  const errors = [];
  if (!scores?.technical || scores.technical < 1 || scores.technical > 5) errors.push('technical score (1-5) required');
  if (!scores?.communication || scores.communication < 1 || scores.communication > 5) errors.push('communication score (1-5) required');
  if (!scores?.culture_fit || scores.culture_fit < 1 || scores.culture_fit > 5) errors.push('culture_fit score (1-5) required');
  if (!scores?.problem_solving || scores.problem_solving < 1 || scores.problem_solving > 5) errors.push('problem_solving score (1-5) required');
  if (!['hire', 'no_hire', 'maybe'].includes(recommendation)) errors.push('recommendation (hire/no_hire/maybe) required');

  if (errors.length > 0) {
    const err = new Error('Validation failed');
    err.details = errors;
    throw err;
  }

  // Update record
  await db.query(
    `UPDATE interview_feedback SET
      score_technical = ?, score_communication = ?, score_culture_fit = ?, score_problem_solving = ?,
      recommendation = ?, notes = ?, status = 'submitted', submitted_at = NOW()
     WHERE access_token = ?`,
    [scores.technical, scores.communication, scores.culture_fit, scores.problem_solving,
     recommendation, notes || null, token]
  );

  logger.info('Feedback submitted', { feedbackId: fb.feedback_id, candidateId: fb.candidate_id });

  // Post to Slack (fire and forget)
  try {
    await slackService.postFeedback({
      candidate_id: fb.candidate_id,
      job_id: fb.job_id,
      candidate_name: fb.candidate_name,
      job_title: fb.job_title,
      interviewer_name: fb.interviewer_name,
      scores,
      recommendation,
    });

    // Check if all feedback is in — if so, post summary
    const summary = await getFeedbackSummary(fb.candidate_id, fb.job_id);
    if (summary.total_submitted === summary.total_requested && summary.total_requested > 0) {
      await slackService.postSummary(summary);
    }
  } catch (err) {
    logger.error('Slack post failed (non-fatal)', { error: err.message });
  }

  return { success: true, feedback_id: fb.feedback_id };
}

/**
 * Get aggregated feedback summary for a candidate.
 */
async function getFeedbackSummary(candidateId, jobId = null) {
  let query = `
    SELECT
      COUNT(*) AS total_requested,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS total_submitted,
      SUM(CASE WHEN status = 'draft' AND token_expires_at < NOW() THEN 1 ELSE 0 END) AS total_overdue,
      AVG(CASE WHEN status = 'submitted' THEN score_technical END) AS avg_technical,
      AVG(CASE WHEN status = 'submitted' THEN score_communication END) AS avg_communication,
      AVG(CASE WHEN status = 'submitted' THEN score_culture_fit END) AS avg_culture_fit,
      AVG(CASE WHEN status = 'submitted' THEN score_problem_solving END) AS avg_problem_solving,
      SUM(CASE WHEN recommendation = 'hire' THEN 1 ELSE 0 END) AS hire_count,
      SUM(CASE WHEN recommendation = 'no_hire' THEN 1 ELSE 0 END) AS no_hire_count,
      SUM(CASE WHEN recommendation = 'maybe' THEN 1 ELSE 0 END) AS maybe_count
    FROM interview_feedback
    WHERE candidate_id = ?
  `;
  const params = [candidateId];

  if (jobId) {
    query += ' AND job_id = ?';
    params.push(jobId);
  }

  const [aggRows] = await db.query(query, params);
  const agg = aggRows[0] || {};

  // Individual feedback entries
  let detailQuery = `
    SELECT interviewer_name, score_technical, score_communication,
           score_culture_fit, score_problem_solving, recommendation,
           notes, submitted_at, status, created_at, token_expires_at
    FROM interview_feedback
    WHERE candidate_id = ?
  `;
  const detailParams = [candidateId];
  if (jobId) {
    detailQuery += ' AND job_id = ?';
    detailParams.push(jobId);
  }
  detailQuery += ' ORDER BY created_at ASC';

  const [details] = await db.query(detailQuery, detailParams);

  const submitted = details.filter((d) => d.status === 'submitted').map((d) => ({
    interviewer_name: d.interviewer_name,
    scores: {
      technical: d.score_technical,
      communication: d.score_communication,
      culture_fit: d.score_culture_fit,
      problem_solving: d.score_problem_solving,
    },
    recommendation: d.recommendation,
    notes: d.notes,
    submitted_at: d.submitted_at,
  }));

  const pending = details.filter((d) => d.status === 'draft').map((d) => ({
    interviewer_name: d.interviewer_name,
    requested_at: d.created_at,
    is_overdue: new Date(d.token_expires_at) < new Date(),
  }));

  const avgTech = parseFloat(agg.avg_technical) || 0;
  const avgComm = parseFloat(agg.avg_communication) || 0;
  const avgCulture = parseFloat(agg.avg_culture_fit) || 0;
  const avgProblem = parseFloat(agg.avg_problem_solving) || 0;
  const overallAvg = (avgTech + avgComm + avgCulture + avgProblem) / 4;

  return {
    candidate_id: candidateId,
    job_id: jobId,
    total_requested: parseInt(agg.total_requested) || 0,
    total_submitted: parseInt(agg.total_submitted) || 0,
    total_overdue: parseInt(agg.total_overdue) || 0,
    average_scores: {
      technical: Math.round(avgTech * 100) / 100,
      communication: Math.round(avgComm * 100) / 100,
      culture_fit: Math.round(avgCulture * 100) / 100,
      problem_solving: Math.round(avgProblem * 100) / 100,
    },
    overall_average: Math.round(overallAvg * 100) / 100,
    recommendations: {
      hire: parseInt(agg.hire_count) || 0,
      no_hire: parseInt(agg.no_hire_count) || 0,
      maybe: parseInt(agg.maybe_count) || 0,
    },
    feedback: submitted,
    pending,
  };
}

module.exports = {
  createFeedbackRequest,
  getFeedbackByToken,
  saveDraft,
  submitFeedback,
  getFeedbackSummary,
};
