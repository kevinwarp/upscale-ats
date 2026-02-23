const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Get pipeline stages for a job (falls back to global defaults).
 */
async function getStages(jobId = null) {
  let [rows] = await db.query(
    'SELECT * FROM pipeline_stages WHERE job_id = ? AND is_active = TRUE ORDER BY sort_order',
    [jobId]
  );

  // Fall back to global defaults if no job-specific stages
  if (rows.length === 0 && jobId !== null) {
    [rows] = await db.query(
      'SELECT * FROM pipeline_stages WHERE job_id IS NULL AND is_active = TRUE ORDER BY sort_order'
    );
  }

  return rows;
}

/**
 * Get full pipeline view for a job — candidates grouped by stage.
 */
async function getPipeline(jobId, { source, feedbackStatus, staleDays, sortBy } = {}) {
  const stages = await getStages(jobId);
  const staleThreshold = staleDays || config.pipeline.staleThresholdDays;

  let candidateQuery = `
    SELECT
      c.candidate_id,
      CONCAT(c.first_name, ' ', c.last_name) AS name,
      c.candidate_stage,
      c.stage_changed_at,
      DATEDIFF(NOW(), c.stage_changed_at) AS days_in_stage,
      c.source,
      c.enrichment_status
    FROM candidate c
    WHERE c.candidate_stage IS NOT NULL
  `;
  const params = [];

  if (source) {
    candidateQuery += ' AND c.source = ?';
    params.push(source);
  }

  switch (sortBy) {
    case 'name':
      candidateQuery += ' ORDER BY c.last_name, c.first_name';
      break;
    case 'feedback_score':
      candidateQuery += ' ORDER BY c.stage_changed_at DESC';
      break;
    default:
      candidateQuery += ' ORDER BY c.stage_changed_at DESC';
  }

  const [candidates] = await db.query(candidateQuery, params);

  // Group candidates by stage
  const stageMap = {};
  for (const stage of stages) {
    stageMap[stage.stage_key] = {
      stage_key: stage.stage_key,
      stage_label: stage.stage_label,
      color_hex: stage.color_hex,
      is_terminal: !!stage.is_terminal,
      candidate_count: 0,
      avg_days_in_stage: 0,
      candidates: [],
    };
  }

  for (const c of candidates) {
    const key = c.candidate_stage;
    if (!stageMap[key]) continue;

    stageMap[key].candidates.push({
      candidate_id: c.candidate_id,
      name: c.name,
      stage_entered_at: c.stage_changed_at,
      days_in_stage: c.days_in_stage || 0,
      is_stale: (c.days_in_stage || 0) > staleThreshold,
      source: c.source,
      feedback_score: null, // Populated when feedback feature is active
      feedback_status: 'none',
    });
    stageMap[key].candidate_count++;
  }

  // Calculate average days in stage per column
  for (const stage of Object.values(stageMap)) {
    if (stage.candidates.length > 0) {
      const totalDays = stage.candidates.reduce((sum, c) => sum + c.days_in_stage, 0);
      stage.avg_days_in_stage = Math.round((totalDays / stage.candidates.length) * 10) / 10;
    }
  }

  return {
    job_id: jobId,
    stages: stages.map((s) => stageMap[s.stage_key]).filter(Boolean),
  };
}

/**
 * Move a candidate to a new stage.
 */
async function moveStage(candidateId, jobId, toStage, userId, reason = null) {
  // Get current stage
  const [current] = await db.query(
    'SELECT candidate_stage FROM candidate WHERE candidate_id = ?',
    [candidateId]
  );

  if (current.length === 0) {
    throw new Error('Candidate not found');
  }

  const fromStage = current[0].candidate_stage;

  if (fromStage === toStage) {
    return { candidate_id: candidateId, from_stage: fromStage, to_stage: toStage, changed: false };
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Update candidate
    await conn.execute(
      'UPDATE candidate SET candidate_stage = ?, stage_changed_at = NOW() WHERE candidate_id = ?',
      [toStage, candidateId]
    );

    // Record history
    await conn.execute(
      `INSERT INTO candidate_stage_history
        (candidate_id, job_id, from_stage, to_stage, changed_by_user_id, change_reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [candidateId, jobId, fromStage, toStage, userId, reason]
    );

    await conn.commit();

    logger.info('Stage transition', { candidateId, fromStage, toStage, userId });

    return {
      candidate_id: candidateId,
      from_stage: fromStage,
      to_stage: toStage,
      stage_changed_at: new Date().toISOString(),
      changed: true,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Get a full scorecard for a candidate.
 */
async function getScorecard(candidateId) {
  // Basic candidate info
  const [rows] = await db.query(
    `SELECT
      c.candidate_id, c.first_name, c.last_name,
      CONCAT(c.first_name, ' ', c.last_name) AS name,
      c.email1 AS email, c.phone_home AS phone,
      c.web_site AS linkedin_url, c.city, c.state,
      c.candidate_stage, c.stage_changed_at, c.source,
      c.current_employer AS company, c.desired_pay AS title
    FROM candidate c
    WHERE c.candidate_id = ?`,
    [candidateId]
  );

  if (rows.length === 0) return null;

  const candidate = rows[0];
  const location = [candidate.city, candidate.state].filter(Boolean).join(', ');

  // Stage info
  const daysInStage = candidate.stage_changed_at
    ? Math.floor((Date.now() - new Date(candidate.stage_changed_at).getTime()) / 86400000)
    : 0;

  // Stage history
  const [history] = await db.query(
    `SELECT from_stage, to_stage, changed_at, change_reason
     FROM candidate_stage_history
     WHERE candidate_id = ?
     ORDER BY changed_at ASC`,
    [candidateId]
  );

  // Get stage config for current stage
  const [stageConfig] = await db.query(
    'SELECT stage_label, color_hex FROM pipeline_stages WHERE stage_key = ? AND (job_id IS NULL) LIMIT 1',
    [candidate.candidate_stage]
  );

  // Feedback summary (if available)
  const [feedbackRows] = await db.query(
    `SELECT
      COUNT(*) AS total_requested,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS total_submitted,
      AVG(CASE WHEN status = 'submitted' THEN (score_technical + score_communication + score_culture_fit + score_problem_solving) / 4.0 END) AS average_score,
      SUM(CASE WHEN recommendation = 'hire' THEN 1 ELSE 0 END) AS hire_count,
      SUM(CASE WHEN recommendation = 'no_hire' THEN 1 ELSE 0 END) AS no_hire_count,
      SUM(CASE WHEN recommendation = 'maybe' THEN 1 ELSE 0 END) AS maybe_count
    FROM interview_feedback
    WHERE candidate_id = ?`,
    [candidateId]
  );

  const fb = feedbackRows[0] || {};

  // Upcoming interviews
  const [upcoming] = await db.query(
    `SELECT ie.id AS event_id, ie.start_time AS date, ie.interview_type AS type, ie.status,
            GROUP_CONCAT(DISTINCT iep.user_id) AS interviewer_ids
     FROM interview_events ie
     LEFT JOIN interview_event_participants iep ON ie.id = iep.event_id
     WHERE ie.candidate_id = ? AND ie.start_time > NOW() AND ie.status = 'scheduled'
     GROUP BY ie.id
     ORDER BY ie.start_time ASC`,
    [candidateId]
  );

  // Past interviews
  const [past] = await db.query(
    `SELECT ie.id AS event_id, ie.start_time AS date, ie.interview_type AS type, ie.status,
            ie.feedback_requested
     FROM interview_events ie
     WHERE ie.candidate_id = ? AND (ie.start_time <= NOW() OR ie.status IN ('completed', 'cancelled'))
     ORDER BY ie.start_time DESC
     LIMIT 10`,
    [candidateId]
  );

  // Recent activity (stage changes)
  const [activity] = await db.query(
    `SELECT 'stage_change' AS type,
            CONCAT('Moved from ', from_stage, ' to ', to_stage) AS description,
            changed_by_user_id AS user_id,
            changed_at AS at
     FROM candidate_stage_history
     WHERE candidate_id = ?
     ORDER BY changed_at DESC
     LIMIT 10`,
    [candidateId]
  );

  // Compute total days in pipeline from first history entry or stage_changed_at
  let totalDaysInPipeline = daysInStage;
  if (history.length > 0) {
    const firstEntry = new Date(history[0].changed_at);
    totalDaysInPipeline = Math.floor((Date.now() - firstEntry.getTime()) / 86400000);
  }

  return {
    candidate_id: candidateId,
    name: candidate.name,
    email: candidate.email,
    phone: candidate.phone,
    linkedin_url: candidate.linkedin_url,
    location,
    stage: {
      current: candidate.candidate_stage,
      label: stageConfig[0]?.stage_label || candidate.candidate_stage,
      color_hex: stageConfig[0]?.color_hex || '#6B7280',
      days_in_stage: daysInStage,
      total_days_in_pipeline: totalDaysInPipeline,
      history: history.map((h) => ({
        from_stage: h.from_stage,
        to_stage: h.to_stage,
        changed_at: h.changed_at,
        reason: h.change_reason,
      })),
    },
    feedback_summary: {
      total_requested: parseInt(fb.total_requested) || 0,
      total_submitted: parseInt(fb.total_submitted) || 0,
      average_score: fb.average_score ? Math.round(fb.average_score * 100) / 100 : null,
      recommendations: {
        hire: parseInt(fb.hire_count) || 0,
        no_hire: parseInt(fb.no_hire_count) || 0,
        maybe: parseInt(fb.maybe_count) || 0,
      },
    },
    upcoming_interviews: upcoming,
    past_interviews: past,
    source: candidate.source,
    recent_activity: activity,
  };
}

/**
 * Update pipeline stages (admin).
 */
async function updateStages(jobId, stages) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Deactivate existing stages for this job
    await conn.execute(
      'UPDATE pipeline_stages SET is_active = FALSE WHERE job_id <=> ?',
      [jobId]
    );

    // Upsert new stages
    for (const stage of stages) {
      await conn.execute(
        `INSERT INTO pipeline_stages (job_id, stage_key, stage_label, sort_order, is_terminal, color_hex, is_active)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE stage_label = ?, sort_order = ?, is_terminal = ?, color_hex = ?, is_active = TRUE`,
        [
          jobId, stage.stage_key, stage.stage_label, stage.sort_order,
          stage.is_terminal || false, stage.color_hex || '#6B7280',
          stage.stage_label, stage.sort_order, stage.is_terminal || false, stage.color_hex || '#6B7280',
        ]
      );
    }

    await conn.commit();
    return getStages(jobId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { getStages, getPipeline, moveStage, getScorecard, updateStages };
