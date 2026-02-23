const axios = require('axios');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Post individual feedback to Slack channel.
 */
async function postFeedback({ candidate_id, job_id, candidate_name, job_title, interviewer_name, scores, recommendation }) {
  if (!config.slack.feedbackWebhookUrl) {
    logger.debug('Slack webhook not configured, skipping post');
    return null;
  }

  const recEmoji = recommendation === 'hire' ? '✅ Hire' : recommendation === 'no_hire' ? '❌ No Hire' : '🤔 Maybe';
  const avgScore = ((scores.technical + scores.communication + scores.culture_fit + scores.problem_solving) / 4).toFixed(1);

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Interview Feedback: ${candidate_name || 'Unknown'} — ${job_title || 'N/A'}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Interviewer:* ${interviewer_name || 'Unknown'}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Technical:* ${starRating(scores.technical)} (${scores.technical}/5)` },
        { type: 'mrkdwn', text: `*Communication:* ${starRating(scores.communication)} (${scores.communication}/5)` },
        { type: 'mrkdwn', text: `*Culture Fit:* ${starRating(scores.culture_fit)} (${scores.culture_fit}/5)` },
        { type: 'mrkdwn', text: `*Problem Solving:* ${starRating(scores.problem_solving)} (${scores.problem_solving}/5)` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recommendation:* ${recEmoji}  |  *Avg Score:* ${avgScore}/5` },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Submitted at ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC` },
      ],
    },
  ];

  // Get or create thread for this candidate+job
  const threadTs = await getOrCreateThread(candidate_id, job_id);

  const payload = { blocks };
  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  try {
    const response = await axios.post(config.slack.feedbackWebhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    });

    logger.info('Slack feedback posted', { candidate_id, interviewer_name });
    return response.data;
  } catch (err) {
    logger.error('Slack webhook post failed', { error: err.message });
    throw err;
  }
}

/**
 * Post a summary message when all feedback is in.
 */
async function postSummary(summary) {
  if (!config.slack.feedbackWebhookUrl) return null;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 All Feedback In: Candidate #${summary.candidate_id}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Technical:* ${summary.average_scores.technical}/5` },
        { type: 'mrkdwn', text: `*Communication:* ${summary.average_scores.communication}/5` },
        { type: 'mrkdwn', text: `*Culture Fit:* ${summary.average_scores.culture_fit}/5` },
        { type: 'mrkdwn', text: `*Problem Solving:* ${summary.average_scores.problem_solving}/5` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Overall:* ${summary.overall_average}/5  |  ✅ ${summary.recommendations.hire} hire / ❌ ${summary.recommendations.no_hire} no-hire / 🤔 ${summary.recommendations.maybe} maybe`,
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `All ${summary.total_submitted} interviewers have submitted feedback` },
      ],
    },
  ];

  const threadTs = await getOrCreateThread(summary.candidate_id, summary.job_id);
  const payload = { blocks };
  if (threadTs) payload.thread_ts = threadTs;

  try {
    await axios.post(config.slack.feedbackWebhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    });
    logger.info('Slack summary posted', { candidate_id: summary.candidate_id });
  } catch (err) {
    logger.error('Slack summary post failed', { error: err.message });
  }
}

/**
 * Get or create a Slack thread for a candidate+job combo.
 */
async function getOrCreateThread(candidateId, jobId) {
  const [rows] = await db.query(
    'SELECT slack_thread_ts FROM feedback_slack_threads WHERE candidate_id = ? AND job_id <=> ?',
    [candidateId, jobId]
  );

  if (rows.length > 0) return rows[0].slack_thread_ts;

  // No thread yet — return null (first message will create the thread).
  // The thread_ts from the first response should be stored, but since
  // webhook responses don't include ts, we'd need the Bot API for true threading.
  // For MVP with webhooks, we skip threading.
  return null;
}

/**
 * Generate star rating string.
 */
function starRating(score) {
  const filled = '⭐'.repeat(Math.min(score, 5));
  const empty = '☆'.repeat(Math.max(5 - score, 0));
  return filled + empty;
}

module.exports = { postFeedback, postSummary, getOrCreateThread, starRating };
