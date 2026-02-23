const axios = require('axios');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const { withRetry, isRetryableHttpError } = require('./retryHelper');

// ============================================================================
// Slack Web API client (Bot Token)
// ============================================================================

let webClient = null;

/**
 * Get or create Slack WebClient.
 * Uses @slack/web-api if available, falls back to axios.
 */
function getWebClient() {
  if (webClient) return webClient;

  try {
    const { WebClient } = require('@slack/web-api');
    webClient = new WebClient(config.slack.botToken);
    logger.info('Slack WebClient initialized (Bot API)');
  } catch {
    // @slack/web-api not installed — use axios fallback
    webClient = null;
    logger.info('Slack WebClient not available, using webhook fallback');
  }

  return webClient;
}

function isBotConfigured() {
  return !!config.slack.botToken;
}

// ============================================================================
// Core messaging: postToChannel, sendDM
// ============================================================================

/**
 * Post a message to a Slack channel.
 *
 * @param {string|null} channel - Channel ID or name. Null = use default hiring channel.
 * @param {Array} blocks - Slack Block Kit blocks
 * @param {object} [opts] - Metadata for audit logging
 * @param {number} [opts.candidateId]
 * @param {number} [opts.jobId]
 * @param {string} [opts.messageType='notification']
 * @param {string} [opts.threadTs] - Reply in thread
 * @returns {Promise<object|null>} Slack API response or null
 */
async function postToChannel(channel, blocks, opts = {}) {
  const targetChannel = channel || config.slack.feedbackChannel || '#hiring';
  const { candidateId, jobId, messageType = 'notification', threadTs } = opts;

  const client = getWebClient();

  if (client && isBotConfigured()) {
    return withRetry(
      async () => {
        const result = await client.chat.postMessage({
          channel: targetChannel,
          blocks,
          text: blocks[0]?.text?.text || 'Notification',
          thread_ts: threadTs || undefined,
        });

        // Store thread_ts for future threading
        if (result.ts && candidateId) {
          await logSlackMessage({
            channelId: result.channel,
            threadTs: threadTs || result.ts,
            messageTs: result.ts,
            messageType,
            candidateId,
            jobId,
            status: 'sent',
          });
        }

        return result;
      },
      { maxRetries: 3, label: 'Slack postToChannel', shouldRetry: isRetryableHttpError }
    );
  }

  // Webhook fallback
  return postViaWebhook(blocks, threadTs, candidateId, jobId, messageType);
}

/**
 * Send a direct message to a Slack user.
 *
 * @param {string} slackUserId - Slack user ID (e.g. U0123456)
 * @param {Array} blocks - Slack Block Kit blocks
 * @param {object} [opts]
 * @returns {Promise<object|null>}
 */
async function sendDM(slackUserId, blocks, opts = {}) {
  const client = getWebClient();
  const { candidateId, jobId, messageType = 'feedback_request' } = opts;

  if (!client || !isBotConfigured()) {
    logger.warn('Cannot send DM: Slack Bot API not configured');
    return null;
  }

  return withRetry(
    async () => {
      // Open DM channel
      const conversation = await client.conversations.open({ users: slackUserId });
      const channelId = conversation.channel.id;

      const result = await client.chat.postMessage({
        channel: channelId,
        blocks,
        text: blocks[0]?.text?.text || 'Message',
      });

      await logSlackMessage({
        channelId,
        messageTs: result.ts,
        messageType,
        candidateId,
        jobId,
        status: 'sent',
      });

      return result;
    },
    { maxRetries: 3, label: 'Slack sendDM', shouldRetry: isRetryableHttpError }
  );
}

/**
 * Look up a Slack user by their email address.
 *
 * @param {string} email
 * @returns {Promise<string|null>} Slack user ID or null
 */
async function lookupUserByEmail(email) {
  const client = getWebClient();
  if (!client || !isBotConfigured() || !email) return null;

  try {
    const result = await client.users.lookupByEmail({ email });
    return result.user?.id || null;
  } catch (err) {
    if (err.data?.error === 'users_not_found') {
      logger.debug('Slack user not found by email', { email });
      return null;
    }
    logger.error('Slack user lookup failed', { email, error: err.message });
    return null;
  }
}

// ============================================================================
// Feedback-specific helpers (preserved from original API)
// ============================================================================

/**
 * Post individual feedback to Slack channel.
 */
async function postFeedback({ candidate_id, job_id, candidate_name, job_title, interviewer_name, scores, recommendation }) {
  if (!config.slack.feedbackWebhookUrl && !isBotConfigured()) {
    logger.debug('Slack not configured, skipping feedback post');
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

  const threadTs = await getOrCreateThread(candidate_id, job_id);

  return postToChannel(config.slack.feedbackChannel, blocks, {
    candidateId: candidate_id,
    jobId: job_id,
    messageType: 'notification',
    threadTs,
  });
}

/**
 * Post a summary message when all feedback is in.
 */
async function postSummary(summary) {
  if (!config.slack.feedbackWebhookUrl && !isBotConfigured()) return null;

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

  return postToChannel(config.slack.feedbackChannel, blocks, {
    candidateId: summary.candidate_id,
    jobId: summary.job_id,
    messageType: 'report',
    threadTs,
  });
}

// ============================================================================
// Milestone notification helpers
// ============================================================================

/**
 * Notify that a new role was created (Step 1).
 */
async function notifyRoleCreated(roleTitle, jobId) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📋 New role created: *${roleTitle}*` },
    },
  ];
  return postToChannel(config.slack.recruitingChannel, blocks, { jobId, messageType: 'notification' });
}

/**
 * Notify that candidates were imported (Steps 2-3).
 */
async function notifyCandidatesImported(count, roleTitle, jobId) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📥 *${count}* candidates added to In Pipeline for *${roleTitle}*` },
    },
  ];
  return postToChannel(config.slack.recruitingChannel, blocks, { jobId, messageType: 'notification' });
}

/**
 * Notify that outreach was logged (Step 4).
 */
async function notifyOutreachLogged(candidateName, candidateId, jobId) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📧 Outreach sent to *${candidateName}*` },
    },
  ];
  return postToChannel(null, blocks, { candidateId, jobId, messageType: 'notification' });
}

/**
 * Notify that an intro call was booked (Step 5).
 */
async function notifyIntroCallBooked(candidateName, candidateId, jobId) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📞 Intro call booked with *${candidateName}*` },
    },
  ];
  return postToChannel(null, blocks, { candidateId, jobId, messageType: 'notification' });
}

/**
 * Notify that a candidate is now actively in pipeline (Step 6).
 */
async function notifyActivePipeline(candidateName, candidateId, jobId) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `✅ *${candidateName}* is now active in pipeline` },
    },
  ];
  return postToChannel(null, blocks, { candidateId, jobId, messageType: 'notification' });
}

/**
 * Notify that homework was received (Step 10).
 */
async function notifyHomeworkReceived(candidateName, candidateId, jobId) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📎 Homework received from *${candidateName}*` },
    },
  ];
  return postToChannel(null, blocks, { candidateId, jobId, messageType: 'notification' });
}

/**
 * Notify that an onsite report is ready (Step 14).
 */
async function notifyReportReady(candidateName, avgScore, candidateId, jobId) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📊 Onsite report ready for *${candidateName}*\nAvg Score: *${avgScore}*` },
    },
  ];
  return postToChannel(null, blocks, { candidateId, jobId, messageType: 'report' });
}

/**
 * Send feedback request DM with button (Steps 7, 13).
 */
async function sendFeedbackRequestDM(slackUserId, { candidateName, jobTitle, feedbackUrl, candidateId, jobId }) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🎤 You interviewed *${candidateName}* for *${jobTitle || 'N/A'}*. Please submit your feedback.`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Submit Feedback' },
          url: feedbackUrl,
          action_id: 'open_feedback_form',
          style: 'primary',
        },
      ],
    },
  ];

  return sendDM(slackUserId, blocks, { candidateId, jobId, messageType: 'feedback_request' });
}

/**
 * Send recruiter DM about homework recommendation (Step 8).
 */
async function sendHomeworkRecommendation(recruiterSlackId, { candidateName, score, candidateId, jobId }) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📝 Candidate *${candidateName}* scored *${score}*. Send homework assignment.`,
      },
    },
  ];
  return sendDM(recruiterSlackId, blocks, { candidateId, jobId, messageType: 'notification' });
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Webhook fallback for posting messages.
 */
async function postViaWebhook(blocks, threadTs, candidateId, jobId, messageType) {
  if (!config.slack.feedbackWebhookUrl) {
    logger.debug('Slack webhook not configured, skipping post');
    return null;
  }

  const payload = { blocks };
  if (threadTs) payload.thread_ts = threadTs;

  return withRetry(
    async () => {
      const response = await axios.post(config.slack.feedbackWebhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });

      await logSlackMessage({
        messageType,
        candidateId,
        jobId,
        status: 'sent',
      });

      return response.data;
    },
    { maxRetries: 3, label: 'Slack webhook', shouldRetry: isRetryableHttpError }
  );
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
  return null;
}

/**
 * Store a record in the slack_messages audit table.
 */
async function logSlackMessage({ channelId, threadTs, messageTs, messageType, candidateId, jobId, status, errorMessage }) {
  try {
    await db.query(
      `INSERT INTO slack_messages
        (channel_id, thread_ts, message_ts, message_type, candidate_id, job_id, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [channelId || null, threadTs || null, messageTs || null, messageType, candidateId || null, jobId || null, status, errorMessage || null]
    );
  } catch (err) {
    logger.error('Failed to log slack message', { error: err.message });
  }
}

/**
 * Generate star rating string.
 */
function starRating(score) {
  const filled = '⭐'.repeat(Math.min(score, 5));
  const empty = '☆'.repeat(Math.max(5 - score, 0));
  return filled + empty;
}

module.exports = {
  // Core messaging
  postToChannel,
  sendDM,
  lookupUserByEmail,

  // Feedback helpers (backward-compatible)
  postFeedback,
  postSummary,
  getOrCreateThread,
  starRating,

  // Milestone notifications
  notifyRoleCreated,
  notifyCandidatesImported,
  notifyOutreachLogged,
  notifyIntroCallBooked,
  notifyActivePipeline,
  notifyHomeworkReceived,
  notifyReportReady,

  // DM helpers
  sendFeedbackRequestDM,
  sendHomeworkRecommendation,

  // Audit
  logSlackMessage,
};
