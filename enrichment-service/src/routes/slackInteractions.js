const express = require('express');
const slackVerify = require('../middleware/slackVerify');
const feedbackService = require('../services/feedbackService');
const workflowEngine = require('../services/workflowEngine');
const slackService = require('../services/slackService');
const db = require('../db');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================================================
// Slack Events API — URL verification + event handling
// ============================================================================

/**
 * POST /v1/slack/events
 * Handles Slack Events API requests (URL verification, event callbacks).
 */
router.post('/events', slackVerify, async (req, res) => {
  const { type, challenge, event } = req.body;

  // URL verification challenge
  if (type === 'url_verification') {
    return res.json({ challenge });
  }

  // Event callback
  if (type === 'event_callback' && event) {
    logger.info('Slack event received', { type: event.type });
    // Future: handle app_mention, message events, etc.
  }

  res.status(200).end();
});

// ============================================================================
// Slack Interactions — button clicks, modal submissions
// ============================================================================

/**
 * POST /v1/slack/interactions
 * Handles Slack interactive payloads (modals, buttons, shortcuts).
 * Slack sends these as application/x-www-form-urlencoded with a `payload` field.
 */
router.post('/interactions', slackVerify, async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload || '{}');
    const { type } = payload;

    switch (type) {
      case 'view_submission':
        await handleModalSubmission(payload, res);
        break;

      case 'block_actions':
        await handleBlockAction(payload, res);
        break;

      case 'shortcut':
        await handleShortcut(payload, res);
        break;

      default:
        res.status(200).end();
    }
  } catch (err) {
    logger.error('Slack interaction error', { error: err.message });
    res.status(200).end();
  }
});

// ============================================================================
// Modal submission handler
// ============================================================================

async function handleModalSubmission(payload, res) {
  const callbackId = payload.view?.callback_id;

  if (callbackId === 'feedback_modal') {
    return handleFeedbackSubmission(payload, res);
  }

  if (callbackId === 'onsite_feedback_modal') {
    return handleOnsiteFeedbackSubmission(payload, res);
  }

  res.status(200).end();
}

/**
 * Handle phone screen feedback modal submission (Steps 7-8).
 */
async function handleFeedbackSubmission(payload, res) {
  const values = payload.view?.state?.values || {};
  const metadata = JSON.parse(payload.view?.private_metadata || '{}');

  const score = parseInt(values.score_block?.score_input?.selected_option?.value) || 0;
  const comments = values.comments_block?.comments_input?.value || '';
  const recommendation = values.recommendation_block?.recommendation_input?.selected_option?.value;

  const { candidate_id, job_id, feedback_token } = metadata;

  try {
    // Submit via feedbackService
    if (feedback_token) {
      await feedbackService.submitFeedback(feedback_token, {
        scores: {
          technical: score,
          communication: score,
          culture_fit: score,
          problem_solving: score,
        },
        recommendation,
        notes: comments,
      });
    }

    // Step 8: Conditional logic
    if (candidate_id) {
      await applyPhoneScreenConditionalLogic(candidate_id, job_id, score);
    }

    // Acknowledge the modal
    res.status(200).json({ response_action: 'clear' });
  } catch (err) {
    logger.error('Feedback modal submission failed', { error: err.message });
    res.status(200).json({
      response_action: 'errors',
      errors: { score_block: err.message },
    });
  }
}

/**
 * Handle onsite feedback modal submission (Step 13).
 */
async function handleOnsiteFeedbackSubmission(payload, res) {
  const values = payload.view?.state?.values || {};
  const metadata = JSON.parse(payload.view?.private_metadata || '{}');

  const score = parseInt(values.score_block?.score_input?.selected_option?.value) || 0;
  const strengths = values.strengths_block?.strengths_input?.value || '';
  const concerns = values.concerns_block?.concerns_input?.value || '';
  const hireDecision = values.hire_block?.hire_input?.selected_option?.value;
  const comments = values.comments_block?.comments_input?.value || '';

  const { feedback_token } = metadata;

  try {
    if (feedback_token) {
      await feedbackService.submitFeedback(feedback_token, {
        scores: {
          technical: score,
          communication: score,
          culture_fit: score,
          problem_solving: score,
        },
        recommendation: hireDecision,
        notes: [strengths && `Strengths: ${strengths}`, concerns && `Concerns: ${concerns}`, comments].filter(Boolean).join('\n\n'),
      });
    }

    res.status(200).json({ response_action: 'clear' });
  } catch (err) {
    logger.error('Onsite feedback submission failed', { error: err.message });
    res.status(200).json({
      response_action: 'errors',
      errors: { score_block: err.message },
    });
  }
}

// ============================================================================
// Block action handler (button clicks)
// ============================================================================

async function handleBlockAction(payload, res) {
  const action = payload.actions?.[0];

  if (action?.action_id === 'open_feedback_modal') {
    const metadata = JSON.parse(action.value || '{}');
    await openFeedbackModal(payload.trigger_id, metadata);
  }

  res.status(200).end();
}

async function handleShortcut(payload, res) {
  // Future: global shortcuts
  res.status(200).end();
}

// ============================================================================
// Modal builders
// ============================================================================

/**
 * Open a feedback modal in Slack.
 */
async function openFeedbackModal(triggerId, metadata) {
  try {
    const { WebClient } = require('@slack/web-api');
    const client = new WebClient(require('../config').slack.botToken);

    const isOnsite = metadata.interview_type === 'onsite';

    const blocks = [
      {
        type: 'input',
        block_id: 'score_block',
        label: { type: 'plain_text', text: 'Score (1-5)' },
        element: {
          type: 'static_select',
          action_id: 'score_input',
          options: [1, 2, 3, 4, 5].map((n) => ({
            text: { type: 'plain_text', text: `${n} - ${['Poor', 'Below Average', 'Average', 'Good', 'Excellent'][n - 1]}` },
            value: String(n),
          })),
        },
      },
      {
        type: 'input',
        block_id: 'recommendation_block',
        label: { type: 'plain_text', text: 'Recommendation' },
        element: {
          type: 'static_select',
          action_id: 'recommendation_input',
          options: [
            { text: { type: 'plain_text', text: '✅ Hire' }, value: 'hire' },
            { text: { type: 'plain_text', text: '❌ No Hire' }, value: 'no_hire' },
            { text: { type: 'plain_text', text: '🤔 Maybe' }, value: 'maybe' },
          ],
        },
      },
    ];

    // Extra fields for onsite
    if (isOnsite) {
      blocks.push(
        {
          type: 'input',
          block_id: 'strengths_block',
          label: { type: 'plain_text', text: 'Strengths' },
          element: { type: 'plain_text_input', action_id: 'strengths_input', multiline: true },
          optional: true,
        },
        {
          type: 'input',
          block_id: 'concerns_block',
          label: { type: 'plain_text', text: 'Concerns' },
          element: { type: 'plain_text_input', action_id: 'concerns_input', multiline: true },
          optional: true,
        }
      );
    }

    blocks.push({
      type: 'input',
      block_id: 'comments_block',
      label: { type: 'plain_text', text: 'Comments' },
      element: { type: 'plain_text_input', action_id: 'comments_input', multiline: true },
      optional: true,
    });

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: isOnsite ? 'onsite_feedback_modal' : 'feedback_modal',
        private_metadata: JSON.stringify(metadata),
        title: { type: 'plain_text', text: isOnsite ? 'Onsite Feedback' : 'Interview Feedback' },
        submit: { type: 'plain_text', text: 'Submit' },
        blocks,
      },
    });
  } catch (err) {
    logger.error('Failed to open feedback modal', { error: err.message });
  }
}

// ============================================================================
// Conditional logic (Step 8)
// ============================================================================

/**
 * After phone screen feedback, apply conditional routing.
 */
async function applyPhoneScreenConditionalLogic(candidateId, jobId, score) {
  // Update phone_screen_score
  await db.query(
    'UPDATE candidate SET phone_screen_score = ? WHERE candidate_id = ?',
    [score, candidateId]
  );

  if (score >= 3) {
    // DM recruiter to send homework
    const [cand] = await db.query(
      "SELECT CONCAT(first_name, ' ', last_name) AS name FROM candidate WHERE candidate_id = ?",
      [candidateId]
    );
    const candidateName = cand[0]?.name || 'Unknown';

    // Find recruiter (job owner or first admin user)
    const [recruiters] = await db.query(
      "SELECT email FROM user WHERE access_level >= 400 LIMIT 1"
    );

    if (recruiters.length > 0) {
      const slackId = await slackService.lookupUserByEmail(recruiters[0].email);
      if (slackId) {
        await slackService.sendHomeworkRecommendation(slackId, {
          candidateName,
          score,
          candidateId,
          jobId,
        });
      }
    }

    logger.info('Phone screen passed, homework recommended', { candidateId, score });
  } else {
    // Auto-reject
    try {
      await workflowEngine.transitionStage({
        candidateId,
        jobId,
        toStage: 'rejected',
        trigger: 'system',
        reason: `Phone screen score below threshold (${score} < 3)`,
      });
      logger.info('Phone screen failed, auto-rejected', { candidateId, score });
    } catch (err) {
      logger.warn('Auto-reject failed', { error: err.message, candidateId });
    }
  }
}

module.exports = router;
module.exports.openFeedbackModal = openFeedbackModal;
module.exports.applyPhoneScreenConditionalLogic = applyPhoneScreenConditionalLogic;
