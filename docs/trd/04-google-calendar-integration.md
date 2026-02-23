# TRD-04: Google Calendar Integration

## 1. Overview

Integrate Google Calendar with Upscale-ATS to enable availability checking, interview scheduling, and post-interview automation. This involves OAuth2 token management, Google Calendar API calls (FreeBusy and Events), new API endpoints, and UI for the scheduling flow.

## 2. Architecture

```
┌──────────────────┐       ┌─────────────────────┐       ┌──────────────────┐
│  Schedule UI     │ ◄───► │  enrichment-service  │ ◄───► │  Google Calendar │
│  (ATS frontend)  │ REST  │  /v1/calendar/*      │ API   │  API (googleapis)│
└──────────────────┘       └─────────────────────┘       └──────────────────┘
                                    │
                              MySQL (shared)
                                    │
                           ┌──────────────┐
                           │   OpenCATS   │
                           │  (profile +  │
                           │   settings)  │
                           └──────────────┘
```

## 3. Google OAuth2 Flow

### 3.1 Configuration

```
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=https://ats.company.com/v1/calendar/oauth/callback
```

### 3.2 OAuth Endpoints

#### Initiate Connection

`GET /v1/calendar/oauth/connect`

Redirects the user to Google's OAuth2 consent screen.

**Implementation:**
```javascript
const { google } = require('googleapis');

function getAuthUrl(userId) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',   // Gets refresh_token
    prompt: 'consent',        // Always show consent to get refresh_token
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    state: JSON.stringify({ user_id: userId })
  });
}
```

#### OAuth Callback

`GET /v1/calendar/oauth/callback?code=xxx&state=xxx`

Exchanges the authorization code for tokens and stores them.

**Implementation:**
```javascript
async function handleCallback(code, state) {
  const { user_id } = JSON.parse(state);
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  // Store tokens
  await db.query(
    `INSERT INTO user_integrations (user_id, provider, access_token, refresh_token, token_expires_at, scopes)
     VALUES (?, 'google_calendar', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE access_token=?, refresh_token=COALESCE(?, refresh_token), token_expires_at=?`,
    [user_id, tokens.access_token, tokens.refresh_token, new Date(tokens.expiry_date),
     'calendar.readonly,calendar.events',
     tokens.access_token, tokens.refresh_token, new Date(tokens.expiry_date)]
  );

  // Redirect back to settings page
  return '/settings?calendar=connected';
}
```

#### Disconnect

`POST /v1/calendar/oauth/disconnect`

Revokes the token with Google and deletes the stored tokens.

### 3.3 Token Management

New file: `enrichment-service/src/services/googleAuth.js`

- `getAuthenticatedClient(userId)` — returns an `oauth2Client` with valid tokens.
- Auto-refreshes expired access tokens using the stored refresh token.
- If refresh fails (revoked), marks integration as disconnected and notifies user.

## 4. Data Model

### 4.1 New Table: `user_integrations`

Stores OAuth tokens per user per integration provider.

```sql
CREATE TABLE user_integrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  provider ENUM('google_calendar', 'zoom', 'slack') NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT DEFAULT NULL,
  token_expires_at DATETIME DEFAULT NULL,
  scopes VARCHAR(500) DEFAULT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE INDEX idx_user_provider (user_id, provider)
);
```

### 4.2 New Table: `interview_events`

Stores interview events created via the ATS.

```sql
CREATE TABLE interview_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id INT NOT NULL,
  job_id INT DEFAULT NULL,
  google_event_id VARCHAR(255) DEFAULT NULL COMMENT 'Google Calendar event ID',
  interview_type VARCHAR(50) NOT NULL COMMENT 'phone_screen, technical, behavioral, onsite',
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  timezone VARCHAR(50) DEFAULT 'UTC',
  location VARCHAR(255) DEFAULT NULL COMMENT 'Physical location or video link',
  meet_link VARCHAR(500) DEFAULT NULL,

  -- Participants
  organizer_user_id INT NOT NULL,
  candidate_email VARCHAR(255) DEFAULT NULL,

  -- Status
  status ENUM('scheduled', 'completed', 'cancelled', 'rescheduled') DEFAULT 'scheduled',
  feedback_requested BOOLEAN DEFAULT FALSE,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_event_candidate (candidate_id),
  INDEX idx_event_job (job_id),
  INDEX idx_event_time (start_time, end_time),
  INDEX idx_event_status (status),
  INDEX idx_event_google (google_event_id)
);
```

### 4.3 New Table: `interview_event_participants`

Links interviewers to events (many-to-many).

```sql
CREATE TABLE interview_event_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  response_status ENUM('needsAction', 'accepted', 'declined', 'tentative') DEFAULT 'needsAction',

  UNIQUE INDEX idx_event_user (event_id, user_id),
  INDEX idx_participant_user (user_id)
);
```

## 5. API Endpoints

### 5.1 Check Availability

`GET /v1/calendar/availability`

**Query params:**
- `interviewer_ids`: Comma-separated user IDs (required).
- `date_start`: ISO date string (default: today).
- `date_end`: ISO date string (default: date_start + 5 business days).
- `duration_minutes`: Slot duration (default: 60).
- `timezone`: IANA timezone (default: `America/Los_Angeles`).

**Implementation:**
Uses Google Calendar FreeBusy API to query each interviewer's busy times, then calculates available slots (intersection of free times across all interviewers).

**Response:**
```json
{
  "timezone": "America/Los_Angeles",
  "duration_minutes": 60,
  "available_slots": [
    { "start": "2026-02-24T09:00:00-08:00", "end": "2026-02-24T10:00:00-08:00" },
    { "start": "2026-02-24T14:00:00-08:00", "end": "2026-02-24T15:00:00-08:00" },
    { "start": "2026-02-25T10:00:00-08:00", "end": "2026-02-25T11:00:00-08:00" }
  ],
  "interviewers": [
    { "user_id": 10, "name": "Alice Smith", "calendar_connected": true },
    { "user_id": 11, "name": "Charlie Brown", "calendar_connected": true }
  ],
  "unavailable_interviewers": []
}
```

**Error cases:**
- If an interviewer hasn't connected Google Calendar → include in `unavailable_interviewers` list, skip their calendar in availability calculation, and warn the recruiter.

### 5.2 Create Interview Event

`POST /v1/calendar/events`

**Request:**
```json
{
  "candidate_id": 123,
  "job_id": 456,
  "interview_type": "technical",
  "interviewer_ids": [10, 11],
  "candidate_email": "bob@example.com",
  "start_time": "2026-02-24T14:00:00-08:00",
  "end_time": "2026-02-24T15:00:00-08:00",
  "timezone": "America/Los_Angeles",
  "title": "Technical Interview — Bob Jones (Senior Engineer)",
  "notes": "Focus on system design and coding.",
  "create_meet_link": true
}
```

**Processing:**
1. Create Google Calendar event via Events.insert API on the organizer's calendar.
2. Add interviewers and candidate as attendees.
3. If `create_meet_link`, add `conferenceData` for Google Meet.
4. Store in `interview_events` + `interview_event_participants` tables.
5. Create activity log entry on candidate profile.
6. If Feature 1 is enabled, pre-create `interview_feedback` records (status=draft, token generated) for each interviewer, with `token_expires_at` set relative to event end time.

**Response:**
```json
{
  "event_id": 1,
  "google_event_id": "abc123xyz",
  "title": "Technical Interview — Bob Jones (Senior Engineer)",
  "start_time": "2026-02-24T14:00:00-08:00",
  "end_time": "2026-02-24T15:00:00-08:00",
  "meet_link": "https://meet.google.com/abc-defg-hij",
  "attendees": [
    { "email": "alice@company.com", "name": "Alice Smith", "role": "interviewer" },
    { "email": "charlie@company.com", "name": "Charlie Brown", "role": "interviewer" },
    { "email": "bob@example.com", "name": "Bob Jones", "role": "candidate" }
  ],
  "feedback_requests_created": 2
}
```

### 5.3 Update Interview Event (Reschedule)

`PATCH /v1/calendar/events/:eventId`

**Request:**
```json
{
  "start_time": "2026-02-25T10:00:00-08:00",
  "end_time": "2026-02-25T11:00:00-08:00",
  "notes": "Rescheduled from 2/24 — interviewer conflict."
}
```

Updates the Google Calendar event via Events.patch, updates `interview_events` table, logs activity.

### 5.4 Cancel Interview Event

`DELETE /v1/calendar/events/:eventId`

Deletes the Google Calendar event, sets `status = 'cancelled'` in DB, creates activity log entry, sends cancellation notification.

### 5.5 Get User Calendar Connection Status

`GET /v1/calendar/status`

Returns the current user's Google Calendar connection status.

**Response:**
```json
{
  "provider": "google_calendar",
  "is_connected": true,
  "connected_at": "2026-02-20T12:00:00Z",
  "scopes": ["calendar.readonly", "calendar.events"],
  "email": "alice@company.com"
}
```

## 6. Calendar Service Module

New file: `enrichment-service/src/services/calendarService.js`

### 6.1 Methods

- `getFreeBusy(userIds, timeMin, timeMax)` — queries FreeBusy API for multiple users.
- `calculateAvailableSlots(busyBlocks, durationMinutes, workingHours)` — computes free intersections.
- `createEvent(organizerUserId, eventData)` — creates Google Calendar event.
- `updateEvent(organizerUserId, googleEventId, updates)` — patches event.
- `deleteEvent(organizerUserId, googleEventId)` — cancels event.
- `getEvent(organizerUserId, googleEventId)` — fetches event details.

### 6.2 Working Hours

Default working hours: 9:00 AM – 5:00 PM in the requested timezone. Admin-configurable per org in future.

Slots are only suggested within working hours. Weekends are excluded.

### 6.3 FreeBusy Implementation

```javascript
async function getFreeBusy(userIds, timeMin, timeMax) {
  const results = {};

  for (const userId of userIds) {
    const auth = await getAuthenticatedClient(userId);
    if (!auth) {
      results[userId] = { connected: false, busy: [] };
      continue;
    }

    const calendar = google.calendar({ version: 'v3', auth });
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: 'primary' }]
      }
    });

    results[userId] = {
      connected: true,
      busy: response.data.calendars.primary.busy || []
    };
  }

  return results;
}
```

## 7. Scheduling UI (OpenCATS)

### 7.1 Schedule Interview Button

On the candidate profile, add a "Schedule Interview" button in the interview schedule section.

Clicking opens a modal/slide-out panel with the scheduling flow.

### 7.2 Scheduling Flow

**Step 1: Select interviewers**
- Multi-select dropdown of users who have connected Google Calendar.
- Shows connection status indicator (green dot = connected, grey = not connected).

**Step 2: View availability**
- Calls `GET /v1/calendar/availability` with selected interviewers.
- Displays a visual time grid showing:
  - Rows = interviewers
  - Columns = time slots
  - Green = all free, Yellow = some free, Grey = all busy
- Clickable green slots to select.

**Step 3: Confirm details**
- Pre-filled form with: slot time, interviewers, candidate email, interview type dropdown, notes field, "Create Meet link" toggle.
- "Schedule" button → calls `POST /v1/calendar/events`.

**Step 4: Confirmation**
- Shows success message with event details and Meet link.
- Interview appears in the candidate's schedule on the profile.

### 7.3 Implementation

New view template: `opencats-module/src/Views/schedule_interview.php`

Inline JS for the multi-step flow. AJAX calls to enrichment service endpoints. For MVP, a simple functional UI. For v2, a polished time-grid component (potentially React).

## 8. Post-Interview Cron Job

### 8.1 Logic

Extend the existing cron job (from Feature 1's feedback reminder) to also handle post-interview triggers:

```javascript
// Run every 15 minutes
async function postInterviewCheck() {
  const recentlyEnded = await db.query(`
    SELECT * FROM interview_events
    WHERE status = 'scheduled'
      AND end_time < NOW()
      AND end_time > DATE_SUB(NOW(), INTERVAL 2 HOUR)
      AND feedback_requested = FALSE
  `);

  for (const event of recentlyEnded) {
    // Trigger feedback requests for each interviewer
    await triggerFeedbackRequests(event);
    // Update event status
    await db.query(
      'UPDATE interview_events SET status = ?, feedback_requested = TRUE WHERE id = ?',
      ['completed', event.id]
    );
    // Log activity
    await logActivity(event.candidate_id, `Interview completed: ${event.interview_type}`);
  }
}
```

## 9. Security

- OAuth tokens are encrypted at rest in the database (use AES-256 encryption for `access_token` and `refresh_token` columns).
- Tokens are never exposed in API responses — only connection status.
- Google Calendar data (event titles, attendees) from FreeBusy queries is not stored — only busy/free time ranges.
- Admin can revoke any user's calendar connection.
- OAuth scopes are minimal: `calendar.readonly` and `calendar.events` (no full account access).

## 10. Dependencies

- `googleapis` npm package (official Google API client for Node.js).
- Google Cloud project with Calendar API enabled.
- OAuth consent screen configured (internal or external, depending on org).

## 11. Testing Plan

### Unit Tests
- Available slot calculation from busy blocks.
- Working hours filtering.
- Timezone conversion.
- Token refresh logic.
- Event creation payload formatting.

### Integration Tests (with mocked Google API)
- OAuth flow: connect → callback → tokens stored.
- Availability check → FreeBusy API called → slots returned.
- Event creation → Google Events.insert called → DB record created → activity logged.
- Reschedule → Google Events.patch called → DB updated.
- Cancel → Google Events.delete called → DB status updated.
- Post-interview cron → feedback requests triggered.

### QA Scenarios
- Schedule across timezones (recruiter in NY, interviewer in SF, candidate in London).
- Interviewer's calendar has all-day events — should be treated as busy.
- Interviewer disconnects Google Calendar after events are scheduled.
- Two recruiters try to schedule the same interviewer for the same slot.
- Event with Google Meet link — verify link is clickable and correct.

## 12. Migration & Rollout

1. Create Google Cloud project, enable Calendar API, configure OAuth consent screen.
2. Run SQL migration: create `user_integrations`, `interview_events`, `interview_event_participants` tables.
3. Deploy enrichment service with calendar endpoints.
4. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in `.env`.
5. Add "Connect Google Calendar" button to user settings page.
6. Add "Schedule Interview" button to candidate profile.
7. Pilot with 2-3 recruiters for 1 week.
8. Enable post-interview feedback automation (requires Feature 1).
9. GA rollout.
