const { google } = require('googleapis');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const googleAuth = require('./googleAuth');

/**
 * Query FreeBusy for multiple interviewers and return available slots.
 */
async function getAvailability(interviewerIds, dateStart, dateEnd, durationMinutes = 60, timezone = 'America/Los_Angeles') {
  const timeMin = new Date(dateStart);
  const timeMax = new Date(dateEnd);
  const busyMap = {};
  const interviewers = [];
  const unavailable = [];

  for (const userId of interviewerIds) {
    const auth = await googleAuth.getAuthenticatedClient(userId);

    // Get user name
    const [userRows] = await db.query(
      "SELECT CONCAT(first_name, ' ', last_name) AS name FROM user WHERE user_id = ?",
      [userId]
    ).catch(() => [[]]); // Graceful fallback if user table doesn't match

    const userName = userRows[0]?.name || `User ${userId}`;

    if (!auth) {
      unavailable.push({ user_id: userId, name: userName });
      continue;
    }

    try {
      const calendar = google.calendar({ version: 'v3', auth });
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          timeZone: timezone,
          items: [{ id: 'primary' }],
        },
      });

      busyMap[userId] = response.data.calendars?.primary?.busy || [];
      interviewers.push({ user_id: userId, name: userName, calendar_connected: true });
    } catch (err) {
      logger.error('FreeBusy query failed', { userId, error: err.message });
      unavailable.push({ user_id: userId, name: userName });
    }
  }

  // Calculate available slots (intersection of free times)
  const availableSlots = calculateAvailableSlots(
    busyMap, timeMin, timeMax, durationMinutes
  );

  return {
    timezone,
    duration_minutes: durationMinutes,
    available_slots: availableSlots,
    interviewers,
    unavailable_interviewers: unavailable,
  };
}

/**
 * Calculate available time slots from busy blocks.
 * Only returns slots during working hours (9am-5pm) on weekdays.
 */
function calculateAvailableSlots(busyMap, timeMin, timeMax, durationMinutes) {
  const slots = [];
  const durationMs = durationMinutes * 60 * 1000;
  const slotStep = 30 * 60 * 1000; // 30-minute increments

  // Merge all busy blocks across interviewers
  const allBusy = [];
  for (const blocks of Object.values(busyMap)) {
    for (const block of blocks) {
      allBusy.push({
        start: new Date(block.start).getTime(),
        end: new Date(block.end).getTime(),
      });
    }
  }

  // Sort and merge overlapping busy blocks
  allBusy.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const block of allBusy) {
    if (merged.length > 0 && block.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, block.end);
    } else {
      merged.push({ ...block });
    }
  }

  // Scan for free slots
  let current = timeMin.getTime();
  const end = timeMax.getTime();

  while (current + durationMs <= end) {
    const slotStart = new Date(current);
    const slotEnd = new Date(current + durationMs);

    // Check working hours (9am-5pm local — simplified as UTC for MVP)
    const hour = slotStart.getUTCHours();
    const day = slotStart.getUTCDay();

    if (day >= 1 && day <= 5 && hour >= 9 && hour < 17) {
      // Check if slot overlaps any busy block
      const isBusy = merged.some(
        (b) => current < b.end && current + durationMs > b.start
      );

      if (!isBusy) {
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }
    }

    current += slotStep;
  }

  return slots;
}

/**
 * Create a Google Calendar event and store in DB.
 */
async function createEvent({
  candidate_id, job_id, interview_type, interviewer_ids,
  candidate_email, start_time, end_time, timezone,
  title, notes, create_meet_link, organizer_user_id,
}) {
  const auth = await googleAuth.getAuthenticatedClient(organizer_user_id);
  if (!auth) throw new Error('Organizer has not connected Google Calendar');

  const calendar = google.calendar({ version: 'v3', auth });

  // Build attendees list
  const attendees = [];
  for (const uid of interviewer_ids) {
    const [rows] = await db.query(
      "SELECT email FROM user WHERE user_id = ?", [uid]
    ).catch(() => [[]]);
    if (rows[0]?.email) attendees.push({ email: rows[0].email });
  }
  if (candidate_email) attendees.push({ email: candidate_email });

  const eventBody = {
    summary: title,
    description: notes || '',
    start: { dateTime: start_time, timeZone: timezone || 'UTC' },
    end: { dateTime: end_time, timeZone: timezone || 'UTC' },
    attendees,
  };

  if (create_meet_link) {
    eventBody.conferenceData = {
      createRequest: {
        requestId: `ats-${candidate_id}-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: eventBody,
    conferenceDataVersion: create_meet_link ? 1 : 0,
    sendUpdates: 'all',
  });

  const googleEvent = response.data;
  const meetLink = googleEvent.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === 'video'
  )?.uri || null;

  // Store in DB
  const [dbResult] = await db.query(
    `INSERT INTO interview_events
      (candidate_id, job_id, google_event_id, interview_type, title, description,
       start_time, end_time, timezone, meet_link, organizer_user_id, candidate_email, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
    [
      candidate_id, job_id || null, googleEvent.id, interview_type, title,
      notes || null, start_time, end_time, timezone || 'UTC',
      meetLink, organizer_user_id, candidate_email || null,
    ]
  );

  const eventId = dbResult.insertId;

  // Add participants
  for (const uid of interviewer_ids) {
    await db.query(
      'INSERT INTO interview_event_participants (event_id, user_id) VALUES (?, ?)',
      [eventId, uid]
    );
  }

  logger.info('Interview event created', { eventId, googleEventId: googleEvent.id, candidateId: candidate_id });

  return {
    event_id: eventId,
    google_event_id: googleEvent.id,
    title,
    start_time,
    end_time,
    meet_link: meetLink,
    attendees: attendees.map((a) => ({ email: a.email })),
  };
}

/**
 * Update (reschedule) an interview event.
 */
async function updateEvent(eventId, updates) {
  const [rows] = await db.query('SELECT * FROM interview_events WHERE id = ?', [eventId]);
  if (rows.length === 0) throw new Error('Event not found');

  const event = rows[0];
  const auth = await googleAuth.getAuthenticatedClient(event.organizer_user_id);

  if (auth && event.google_event_id) {
    const calendar = google.calendar({ version: 'v3', auth });
    const patch = {};
    if (updates.start_time) patch.start = { dateTime: updates.start_time, timeZone: event.timezone };
    if (updates.end_time) patch.end = { dateTime: updates.end_time, timeZone: event.timezone };
    if (updates.notes) patch.description = updates.notes;

    await calendar.events.patch({
      calendarId: 'primary',
      eventId: event.google_event_id,
      requestBody: patch,
      sendUpdates: 'all',
    });
  }

  // Update DB
  const dbUpdates = [];
  const params = [];
  if (updates.start_time) { dbUpdates.push('start_time = ?'); params.push(updates.start_time); }
  if (updates.end_time) { dbUpdates.push('end_time = ?'); params.push(updates.end_time); }
  if (updates.notes) { dbUpdates.push('description = ?'); params.push(updates.notes); }
  dbUpdates.push("status = 'rescheduled'");
  params.push(eventId);

  if (dbUpdates.length > 0) {
    await db.query(`UPDATE interview_events SET ${dbUpdates.join(', ')} WHERE id = ?`, params);
  }

  logger.info('Interview event updated', { eventId });
  return { event_id: eventId, updated: true };
}

/**
 * Cancel an interview event.
 */
async function cancelEvent(eventId) {
  const [rows] = await db.query('SELECT * FROM interview_events WHERE id = ?', [eventId]);
  if (rows.length === 0) throw new Error('Event not found');

  const event = rows[0];
  const auth = await googleAuth.getAuthenticatedClient(event.organizer_user_id);

  if (auth && event.google_event_id) {
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: event.google_event_id,
      sendUpdates: 'all',
    });
  }

  await db.query(
    "UPDATE interview_events SET status = 'cancelled' WHERE id = ?",
    [eventId]
  );

  logger.info('Interview event cancelled', { eventId });
  return { event_id: eventId, cancelled: true };
}

module.exports = {
  getAvailability, calculateAvailableSlots,
  createEvent, updateEvent, cancelEvent,
};
