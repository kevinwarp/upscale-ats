const express = require('express');
const googleAuth = require('../services/googleAuth');
const calendarService = require('../services/calendarService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /v1/calendar/oauth/connect — Redirect to Google OAuth consent.
 */
router.get('/oauth/connect', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || parseInt(req.query.user_id);
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const url = googleAuth.getAuthUrl(userId);
  res.redirect(url);
});

/**
 * GET /v1/calendar/oauth/callback — OAuth callback handler.
 */
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).json({ error: 'Missing code or state' });

    await googleAuth.handleCallback(code, state);
    res.redirect('/settings?calendar=connected');
  } catch (err) {
    logger.error('OAuth callback failed', { error: err.message });
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

/**
 * POST /v1/calendar/oauth/disconnect — Disconnect Google Calendar.
 */
router.post('/oauth/disconnect', async (req, res) => {
  try {
    const userId = parseInt(req.headers['x-user-id']);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });

    await googleAuth.disconnect(userId);
    res.json({ disconnected: true });
  } catch (err) {
    logger.error('Disconnect failed', { error: err.message });
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

/**
 * GET /v1/calendar/status — Get calendar connection status.
 */
router.get('/status', async (req, res) => {
  try {
    const userId = parseInt(req.headers['x-user-id']);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });

    const status = await googleAuth.getConnectionStatus(userId);
    res.json(status);
  } catch (err) {
    logger.error('Get status failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * GET /v1/calendar/availability — Check interviewer availability.
 */
router.get('/availability', async (req, res) => {
  try {
    const { interviewer_ids, date_start, date_end, duration_minutes, timezone } = req.query;

    if (!interviewer_ids) {
      return res.status(400).json({ error: 'interviewer_ids is required' });
    }

    const ids = interviewer_ids.split(',').map((id) => parseInt(id.trim()));
    const start = date_start || new Date().toISOString();
    const end = date_end || new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

    const result = await calendarService.getAvailability(
      ids, start, end,
      duration_minutes ? parseInt(duration_minutes) : 60,
      timezone || 'America/Los_Angeles'
    );

    res.json(result);
  } catch (err) {
    logger.error('Availability check failed', { error: err.message });
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

/**
 * POST /v1/calendar/events — Create an interview event.
 */
router.post('/events', async (req, res) => {
  try {
    const userId = parseInt(req.headers['x-user-id']);
    const result = await calendarService.createEvent({
      ...req.body,
      organizer_user_id: userId || req.body.organizer_user_id,
    });
    res.status(201).json(result);
  } catch (err) {
    logger.error('Create event failed', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed to create event' });
  }
});

/**
 * PATCH /v1/calendar/events/:eventId — Reschedule an event.
 */
router.patch('/events/:eventId', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const result = await calendarService.updateEvent(eventId, req.body);
    res.json(result);
  } catch (err) {
    if (err.message === 'Event not found') return res.status(404).json({ error: 'Event not found' });
    logger.error('Update event failed', { error: err.message });
    res.status(500).json({ error: 'Failed to update event' });
  }
});

/**
 * DELETE /v1/calendar/events/:eventId — Cancel an event.
 */
router.delete('/events/:eventId', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const result = await calendarService.cancelEvent(eventId);
    res.json(result);
  } catch (err) {
    if (err.message === 'Event not found') return res.status(404).json({ error: 'Event not found' });
    logger.error('Cancel event failed', { error: err.message });
    res.status(500).json({ error: 'Failed to cancel event' });
  }
});

module.exports = router;
