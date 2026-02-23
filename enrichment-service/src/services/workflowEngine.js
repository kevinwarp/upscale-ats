const db = require('../db');
const logger = require('../utils/logger');

// Lazy-loaded to avoid circular deps (slackService → workflowEngine → slackService)
let slackService = null;
function getSlackService() {
  if (!slackService) slackService = require('./slackService');
  return slackService;
}

// ============================================================================
// Stage definitions and valid transitions
// ============================================================================

const STAGES = {
  in_pipeline: { label: 'In Pipeline', order: 1 },
  phone_screen: { label: 'Phone Screen', order: 2 },
  homework_assignment: { label: 'Homework Assignment', order: 3 },
  onsite_interview: { label: 'Onsite Interview', order: 4 },
  offer: { label: 'Offer', order: 5 },
  rejected: { label: 'Rejected', order: 6, terminal: true },
};

/**
 * Valid forward transitions. Any stage can also transition to 'rejected'.
 */
const VALID_TRANSITIONS = {
  in_pipeline: ['phone_screen', 'rejected'],
  phone_screen: ['homework_assignment', 'rejected'],
  homework_assignment: ['onsite_interview', 'rejected'],
  onsite_interview: ['offer', 'rejected'],
  offer: ['rejected'],
  rejected: [], // terminal — no transitions out
};

// ============================================================================
// Core transition function
// ============================================================================

/**
 * Transition a candidate to a new stage with full orchestration:
 *   1. Validate transition
 *   2. Update candidate record
 *   3. Log to candidate_stage_history
 *   4. Log to workflow_events
 *   5. Fire Slack notification
 *
 * @param {object} params
 * @param {number} params.candidateId
 * @param {number} [params.jobId]
 * @param {string} params.toStage - Target stage key
 * @param {string} [params.trigger='manual'] - What triggered this: manual | gmail | calendar | slack | system
 * @param {number} [params.userId=0] - User who initiated (0 = system)
 * @param {string} [params.reason] - Human-readable reason
 * @param {object} [params.metadata] - Extra data to store in workflow_event
 * @param {boolean} [params.skipValidation=false] - Skip transition validation (for admin overrides)
 * @returns {Promise<object>} Transition result
 */
async function transitionStage({
  candidateId, jobId = null, toStage, trigger = 'manual',
  userId = 0, reason = null, metadata = {}, skipValidation = false,
}) {
  // 1. Get current stage
  const [current] = await db.query(
    'SELECT candidate_stage, CONCAT(first_name, \' \', last_name) AS name FROM candidate WHERE candidate_id = ?',
    [candidateId]
  );

  if (current.length === 0) {
    throw new Error('Candidate not found');
  }

  const fromStage = current[0].candidate_stage;
  const candidateName = current[0].name;

  if (fromStage === toStage) {
    return { candidate_id: candidateId, from_stage: fromStage, to_stage: toStage, changed: false };
  }

  // 2. Validate transition
  if (!skipValidation) {
    const validTargets = VALID_TRANSITIONS[fromStage] || [];
    if (!validTargets.includes(toStage)) {
      throw new Error(
        `Invalid stage transition: ${fromStage} → ${toStage}. ` +
        `Valid targets: ${validTargets.join(', ') || 'none (terminal stage)'}`
      );
    }
  }

  if (!STAGES[toStage]) {
    throw new Error(`Unknown stage: ${toStage}`);
  }

  // 3. Execute in transaction
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Update candidate
    await conn.execute(
      'UPDATE candidate SET candidate_stage = ?, stage_changed_at = NOW() WHERE candidate_id = ?',
      [toStage, candidateId]
    );

    // Log stage history
    await conn.execute(
      `INSERT INTO candidate_stage_history
        (candidate_id, job_id, from_stage, to_stage, changed_by_user_id, change_reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [candidateId, jobId, fromStage, toStage, userId, reason]
    );

    // Log workflow event
    await conn.execute(
      `INSERT INTO workflow_events (candidate_id, job_id, event_type, event_data, source)
       VALUES (?, ?, 'stage_transition', ?, ?)`,
      [
        candidateId,
        jobId,
        JSON.stringify({
          from_stage: fromStage,
          to_stage: toStage,
          reason,
          triggered_by: userId,
          ...metadata,
        }),
        trigger,
      ]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  logger.info('Stage transition', {
    candidateId, fromStage, toStage, trigger, userId,
  });

  // 4. Fire Slack notification (non-blocking)
  fireStageNotification({
    candidateId, candidateName, jobId, fromStage, toStage, trigger,
  }).catch((err) => {
    logger.error('Slack stage notification failed (non-fatal)', { error: err.message });
  });

  return {
    candidate_id: candidateId,
    from_stage: fromStage,
    to_stage: toStage,
    stage_changed_at: new Date().toISOString(),
    changed: true,
    trigger,
  };
}

// ============================================================================
// Workflow event logging (non-stage events)
// ============================================================================

/**
 * Log a generic workflow event (not a stage transition).
 */
async function logEvent({ candidateId, jobId = null, eventType, eventData = {}, source = 'system' }) {
  await db.query(
    'INSERT INTO workflow_events (candidate_id, job_id, event_type, event_data, source) VALUES (?, ?, ?, ?, ?)',
    [candidateId, jobId, eventType, JSON.stringify(eventData), source]
  );

  logger.info('Workflow event logged', { candidateId, eventType, source });
}

// ============================================================================
// Slack notifications for stage transitions
// ============================================================================

async function fireStageNotification({ candidateId, candidateName, jobId, fromStage, toStage, trigger }) {
  const slack = getSlackService();
  const stageLabel = STAGES[toStage]?.label || toStage;
  const triggerLabel = trigger === 'manual' ? '' : ` (auto: ${trigger})`;

  const text = `${candidateName} moved to *${stageLabel}*${triggerLabel}`;

  try {
    await slack.postToChannel(null, [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Candidate #${candidateId} | ${fromStage} → ${toStage}` },
        ],
      },
    ], { candidateId, jobId, messageType: 'notification' });
  } catch (err) {
    logger.error('Stage notification failed', { error: err.message, candidateId });
  }
}

// ============================================================================
// Helpers
// ============================================================================

function isValidStage(stage) {
  return !!STAGES[stage];
}

function isTerminalStage(stage) {
  return !!STAGES[stage]?.terminal;
}

function getValidTransitions(fromStage) {
  return VALID_TRANSITIONS[fromStage] || [];
}

module.exports = {
  STAGES,
  VALID_TRANSITIONS,
  transitionStage,
  logEvent,
  isValidStage,
  isTerminalStage,
  getValidTransitions,
};
