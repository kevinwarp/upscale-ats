const express = require('express');
const pipelineService = require('../services/pipelineService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /v1/pipeline/stages
 * Get configured stages for a job (or global defaults).
 */
router.get('/stages', async (req, res) => {
  try {
    const jobId = req.query.job_id ? parseInt(req.query.job_id) : null;
    const stages = await pipelineService.getStages(jobId);
    res.json({ job_id: jobId, stages });
  } catch (err) {
    logger.error('Failed to get stages', { error: err.message });
    res.status(500).json({ error: 'Failed to get stages' });
  }
});

/**
 * PUT /v1/pipeline/stages
 * Update pipeline stages (admin).
 */
router.put('/stages', async (req, res) => {
  try {
    const { job_id, stages } = req.body;

    if (!Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ error: 'stages array is required' });
    }

    for (const s of stages) {
      if (!s.stage_key || !s.stage_label || s.sort_order == null) {
        return res.status(400).json({ error: 'Each stage requires stage_key, stage_label, and sort_order' });
      }
    }

    const updated = await pipelineService.updateStages(job_id ?? null, stages);
    res.json({ job_id: job_id ?? null, stages: updated });
  } catch (err) {
    logger.error('Failed to update stages', { error: err.message });
    res.status(500).json({ error: 'Failed to update stages' });
  }
});

/**
 * GET /v1/pipeline/:jobId
 * Get full pipeline view for a job.
 */
router.get('/:jobId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const { source, feedback_status, stale_days, sort_by } = req.query;

    const result = await pipelineService.getPipeline(jobId, {
      source,
      feedbackStatus: feedback_status,
      staleDays: stale_days ? parseInt(stale_days) : undefined,
      sortBy: sort_by,
    });

    res.json(result);
  } catch (err) {
    logger.error('Failed to get pipeline', { error: err.message });
    res.status(500).json({ error: 'Failed to get pipeline' });
  }
});

/**
 * PATCH /v1/pipeline/:jobId/candidates/:candidateId/stage
 * Move a candidate to a new stage.
 */
router.patch('/:jobId/candidates/:candidateId/stage', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const candidateId = parseInt(req.params.candidateId);
    const userId = parseInt(req.headers['x-user-id']) || 0;
    const { to_stage, reason } = req.body;

    if (!to_stage) {
      return res.status(400).json({ error: 'to_stage is required' });
    }

    const result = await pipelineService.moveStage(candidateId, jobId, to_stage, userId, reason);
    res.json(result);
  } catch (err) {
    if (err.message === 'Candidate not found') {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    logger.error('Failed to move stage', { error: err.message });
    res.status(500).json({ error: 'Failed to move stage' });
  }
});

module.exports = router;
