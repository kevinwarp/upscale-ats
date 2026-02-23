const { google } = require('googleapis');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const googleAuth = require('./googleAuth');
const workflowEngine = require('./workflowEngine');
const slackService = require('./slackService');

// ============================================================================
// Calendar Watch — push notification subscription
// ============================================================================

/**
 * Set up a Google Calendar watch channel for a user.
 * Push notifications are sent to POST /v1/calendar/webhook.
 */
async function setupWatch(userId) {
  const auth = await googleAuth.getAuthenticatedClient(userId);
  if (!auth) return null;

  const calendar = google.calendar({ version: 'v3', auth });
  const channelId = `ats-cal-${userId}-${Date.now()}`;
  const webhookUrl = `${config.baseUrl}/v1/calendar/webhook`;

  try {
    const response = await calendar.events.watch({
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        expiration: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    });

    // Store channel info for renewal
    await db.query(
      `INSERT INTO user_integrations (user_id, provider, access_token, scopes, is_active)
       VALUES (?, 'google_calendar_watch', ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE access_token = ?, scopes = ?, is_active = TRUE`,
      [userId, channelId, response.data.resourceId, channelId, response.data.resourceId]
    );

    logger.info('Calendar watch registered', { userId, channelId });
    return response.data;
  } catch (err) {
    logger.error('Calendar watch setup failed', { userId, error: err.message });
    throw err;
  }
}

// ============================================================================
// Event processing — detect hiring workflow events
// ============================================================================

/**
 * Process a newly detected calendar event.
 * Determines if it's an intro call (1-on-1) or onsite (multi-interviewer).
 */
async function processEvent(event) {
  const attendees = event.attendees || [];
  if (attendees.length === 0) return null;

  // Find candidate among attendees (match by email against candidate table)
  const candidateMatch = await findCandidateAttendee(attendees);
  if (!candidateMatch) return null;

  // Count internal vs external attendees
  const internalAttendees = [];
  for (const a of attendees) {
    if (a.email === candidateMatch.email) continue;
    // Check if attendee is an internal user
    const [users] = await db.query(
      'SELECT user_id FROM user WHERE email = ? LIMIT 1',
      [a.email]
    );
    if (users.length > 0) {
      internalAttendees.push({ userId: users[0].user_id, email: a.email });
    }
  }

  if (internalAttendees.length === 0) return null;

  const candidateId = candidateMatch.candidateId;
  const candidateName = candidateMatch.name;

  // Step 5: Intro call (1-on-1 with candidate)
  if (internalAttendees.length === 1) {
    return handleIntroCall(candidateId, candidateName, event);
  }

  // Steps 11-12: Onsite (multiple interviewers + candidate)
  if (internalAttendees.length >= 2) {
    return handleOnsiteScheduled(candidateId, candidateName, internalAttendees, event);
  }

  return null;
}

/**
 * Handle intro call detection (Step 5 + Step 6).
 */
async function handleIntroCall(candidateId, candidateName, event) {
  try {
    // Move to phone_screen
    await workflowEngine.transitionStage({
      candidateId,
      toStage: 'phone_screen',
      trigger: 'calendar',
      reason: `Intro call detected: ${event.summary || 'Calendar event'}`,
      metadata: { googleEventId: event.id },
    });

    // Set active_pipeline = true (Step 6)
    await db.query(
      'UPDATE candidate SET active_pipeline = TRUE WHERE candidate_id = ?',
      [candidateId]
    );

    await workflowEngine.logEvent({
      candidateId,
      eventType: 'active_pipeline_set',
      eventData: { googleEventId: event.id },
      source: 'calendar',
    });

    // Slack notifications
    slackService.notifyIntroCallBooked(candidateName, candidateId).catch(() => {});
    slackService.notifyActivePipeline(candidateName, candidateId).catch(() => {});

    logger.info('Intro call detected', { candidateId, eventId: event.id });
    return { action: 'intro_call', candidateId };
  } catch (err) {
    logger.warn('Intro call processing failed', { error: err.message, candidateId });
    return null;
  }
}

/**
 * Handle onsite scheduling detection (Steps 11-12).
 */
async function handleOnsiteScheduled(candidateId, candidateName, interviewers, event) {
  try {
    await workflowEngine.transitionStage({
      candidateId,
      toStage: 'onsite_interview',
      trigger: 'calendar',
      reason: `Onsite detected: ${interviewers.length} interviewers`,
      metadata: {
        googleEventId: event.id,
        interviewerCount: interviewers.length,
      },
    });

    // Notify each interviewer via Slack DM
    for (const interviewer of interviewers) {
      const slackId = await slackService.lookupUserByEmail(interviewer.email);
      if (slackId) {
        slackService.sendDM(slackId, [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📅 You have an onsite interview scheduled with *${candidateName}*: ${event.summary || 'Interview'}`,
            },
          },
        ], { candidateId, messageType: 'notification' }).catch(() => {});
      }
    }

    logger.info('Onsite scheduled detected', { candidateId, interviewerCount: interviewers.length });
    return { action: 'onsite_scheduled', candidateId };
  } catch (err) {
    logger.warn('Onsite processing failed', { error: err.message, candidateId });
    return null;
  }
}

// ============================================================================
// Polling fallback — sync recent events for all connected users
// ============================================================================

/**
 * Poll recent calendar events for all users with connected calendars.
 * Used as a fallback when push notifications aren't available.
 */
async function pollRecentEvents() {
  const [integrations] = await db.query(
    "SELECT user_id FROM user_integrations WHERE provider = 'google_calendar' AND is_active = TRUE"
  );

  let totalProcessed = 0;

  for (const { user_id: userId } of integrations) {
    try {
      const events = await fetchRecentEvents(userId);
      for (const event of events) {
        const result = await processEvent(event);
        if (result) totalProcessed++;
      }
    } catch (err) {
      logger.error('Calendar poll failed for user', { userId, error: err.message });
    }
  }

  if (totalProcessed > 0) {
    logger.info('Calendar poll completed', { totalProcessed });
  }

  return totalProcessed;
}

/**
 * Fetch events created/updated in the last interval for a user.
 */
async function fetchRecentEvents(userId) {
  const auth = await googleAuth.getAuthenticatedClient(userId);
  if (!auth) return [];

  const calendar = google.calendar({ version: 'v3', auth });
  const updatedMin = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // last 10 minutes

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      updatedMin,
      singleEvents: true,
      orderBy: 'updated',
      maxResults: 20,
    });

    return response.data.items || [];
  } catch (err) {
    logger.error('Calendar event fetch failed', { userId, error: err.message });
    return [];
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find a candidate among event attendees.
 */
async function findCandidateAttendee(attendees) {
  for (const attendee of attendees) {
    if (!attendee.email) continue;

    const [rows] = await db.query(
      `SELECT candidate_id, CONCAT(first_name, ' ', last_name) AS name
       FROM candidate
       WHERE email1 = ? OR personal_email = ?
       LIMIT 1`,
      [attendee.email, attendee.email]
    );

    if (rows.length > 0) {
      return {
        candidateId: rows[0].candidate_id,
        name: rows[0].name,
        email: attendee.email,
      };
    }
  }

  return null;
}

module.exports = {
  setupWatch,
  processEvent,
  handleIntroCall,
  handleOnsiteScheduled,
  pollRecentEvents,
  fetchRecentEvents,
  findCandidateAttendee,
};
