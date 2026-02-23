const express = require('express');
const path = require('path');
const feedbackService = require('../services/feedbackService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /v1/feedback/request — Create a feedback request (auth required).
 */
router.post('/request', async (req, res) => {
  try {
    const {
      candidate_id, job_id, interviewer_user_id, interviewer_email,
      interviewer_name, candidate_name, job_title, event_id,
    } = req.body;

    if (!candidate_id || !interviewer_user_id) {
      return res.status(400).json({ error: 'candidate_id and interviewer_user_id are required' });
    }

    const result = await feedbackService.createFeedbackRequest({
      candidate_id, job_id, interviewer_user_id, interviewer_email,
      interviewer_name, candidate_name, job_title, event_id,
    });

    res.status(201).json(result);
  } catch (err) {
    logger.error('Create feedback request failed', { error: err.message });
    res.status(500).json({ error: 'Failed to create feedback request' });
  }
});

/**
 * GET /v1/feedback/summary/:candidateId — Aggregated summary (auth required).
 */
router.get('/summary/:candidateId', async (req, res) => {
  try {
    const candidateId = parseInt(req.params.candidateId);
    const jobId = req.query.job_id ? parseInt(req.query.job_id) : null;
    const summary = await feedbackService.getFeedbackSummary(candidateId, jobId);
    res.json(summary);
  } catch (err) {
    logger.error('Get feedback summary failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get feedback summary' });
  }
});

/**
 * GET /v1/feedback/:token — Get feedback form data (no auth — token-based).
 */
router.get('/:token', async (req, res) => {
  try {
    // If token looks like an HTML request (browser), serve the form page
    if (req.accepts('html') && !req.accepts('json')) {
      return res.sendFile(path.join(__dirname, '..', 'public', 'feedback-form.html'));
    }

    const fb = await feedbackService.getFeedbackByToken(req.params.token);
    if (!fb) {
      return res.status(404).json({ error: 'Feedback not found or link expired' });
    }
    res.json(fb);
  } catch (err) {
    logger.error('Get feedback failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get feedback' });
  }
});

/**
 * PATCH /v1/feedback/:token — Save draft (no auth — token-based).
 */
router.patch('/:token', async (req, res) => {
  try {
    const { scores, recommendation, notes } = req.body;
    const result = await feedbackService.saveDraft(req.params.token, { scores, recommendation, notes });
    res.json(result);
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('expired') || err.message.includes('not in draft')) {
      return res.status(400).json({ error: err.message });
    }
    logger.error('Save draft failed', { error: err.message });
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

/**
 * POST /v1/feedback/:token/submit — Submit feedback (no auth — token-based).
 */
router.post('/:token/submit', async (req, res) => {
  try {
    const { scores, recommendation, notes } = req.body;
    const result = await feedbackService.submitFeedback(req.params.token, { scores, recommendation, notes });
    res.json(result);
  } catch (err) {
    if (err.details) {
      return res.status(400).json({ error: err.message, details: err.details });
    }
    if (err.message.includes('not found') || err.message.includes('expired') || err.message.includes('not in draft')) {
      return res.status(400).json({ error: err.message });
    }
    logger.error('Submit feedback failed', { error: err.message });
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

module.exports = router;
