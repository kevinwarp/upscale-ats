# PRD-04: Google Calendar Integration

## 1. Problem Statement

Scheduling interviews is one of the most time-consuming parts of recruiting. Today, recruiters manually check interviewers' calendars (often via Slack or email), find overlapping free slots, then create a calendar event and send invitations — a process that takes 10-15 minutes per interview and is error-prone (double-bookings, timezone mismatches, forgotten invitations). There's also no link between the calendar event and the ATS, so interviewers don't get automatic feedback requests, and recruiters can't see the interview schedule on the candidate profile.

## 2. Goal

Enable recruiters to check interviewer availability and schedule interviews directly from the ATS in under 2 minutes, with automatic calendar event creation, video conferencing link generation, activity logging, and integration with the feedback system.

## 3. Success Metrics

- Average time to schedule an interview decreases from ~12 minutes to ≤2 minutes.
- ≥95% of scheduled interviews have the correct availability (no double-bookings).
- 100% of interview events created via the ATS are logged in the candidate activity feed.
- ≥90% of interview events trigger an automatic feedback request post-interview (when Feature 1 is enabled).

## 4. Target Users

- **Recruiter**: Primary user. Schedules interviews for candidates.
- **Interviewer**: Grants calendar access; sees interviews on their calendar; availability is checked automatically.
- **Hiring Manager**: Occasionally schedules interviews; views candidate interview schedule.
- **Admin**: Configures Google OAuth credentials and default settings (meeting duration, video link provider).

## 5. User Stories

### Recruiter
- As a recruiter, I click "Schedule Interview" on a candidate's profile and see available time slots across multiple interviewers' calendars, so I can pick a time that works for everyone.
- As a recruiter, I select a time slot, add interview details (type, duration, notes), and click "Schedule" — the system creates a Google Calendar event for all participants and adds a Google Meet (or Zoom) link.
- As a recruiter, I see the scheduled interview appear immediately on the candidate's profile in the interview schedule section.
- As a recruiter, I can reschedule or cancel an interview from the ATS, and the calendar event updates automatically.

### Interviewer
- As an interviewer, I connect my Google Calendar once via OAuth, and the ATS can check my availability going forward.
- As an interviewer, I see the interview event on my Google Calendar with the candidate name, role, and a link to their ATS profile.
- As an interviewer, after the interview ends, I receive an automatic feedback request (from Feature 1).

### Admin
- As an admin, I configure the Google OAuth client credentials (client ID, secret, redirect URI) in the ATS settings.
- As an admin, I set default interview duration (30, 45, or 60 minutes) and preferred video link provider (Google Meet or Zoom).
- As an admin, I see which users have connected their Google Calendar and can revoke connections.

## 6. Requirements

### 6.1 Google OAuth2 Connection

- Each user connects their Google account via OAuth2 consent flow.
- Scopes requested: `https://www.googleapis.com/auth/calendar.readonly` (for freebusy) and `https://www.googleapis.com/auth/calendar.events` (for event creation).
- Tokens stored per user, refreshed automatically.
- Users can disconnect at any time from their settings page.

### 6.2 Availability Checker

- Recruiter selects one or more interviewers + a date range (default: next 5 business days).
- System queries Google Calendar FreeBusy API for each interviewer.
- Displays available time slots (intersected across all selected interviewers).
- Slots are presented in the recruiter's timezone with clear labels.
- Slot duration matches the configured interview duration (default: 60 minutes).
- Busy times are shown as greyed-out blocks (with event title hidden for privacy).

### 6.3 Interview Scheduling

- Recruiter selects an available slot and fills in:
  - **Interview type** (e.g., Phone Screen, Technical, Behavioral, Onsite).
  - **Duration** (default from settings; editable).
  - **Interviewers** (pre-filled from availability check).
  - **Candidate email** (for calendar invitation).
  - **Notes / agenda** (optional, included in calendar event description).
  - **Video link**: Auto-generate Google Meet link, or insert a Zoom link (if Zoom integration is configured).
- On "Schedule":
  - Creates a Google Calendar event on the primary interviewer's calendar.
  - Adds all interviewers and the candidate as attendees.
  - Includes in the event description: candidate name, role, ATS profile link, notes.
  - Logs the event in the ATS: `interview_events` table + candidate activity log.
  - If Feature 1 is enabled: pre-creates feedback request records to be sent after the event ends.

### 6.4 Reschedule / Cancel

- From the candidate profile's interview schedule, recruiter can:
  - **Reschedule**: Opens availability checker pre-filled with the same interviewers; on new slot selection, updates the Google Calendar event.
  - **Cancel**: Deletes the Google Calendar event, marks the interview as cancelled in the ATS, sends cancellation notification.

### 6.5 Post-Interview Automation

- After the interview event end time, trigger:
  - Feedback request (Feature 1) to each interviewer.
  - Activity log entry: "Interview completed: {type} with {interviewer(s)}".
- Trigger mechanism: Cron job checking for events that ended in the last hour (same cron as feedback reminder, or combined).

## 7. Out of Scope (v1)

- Microsoft Outlook / Office 365 calendar support (architecture should be extensible for future).
- Zoom OAuth integration for link generation (use manual Zoom link or Google Meet for v1).
- Self-scheduling: Candidate picks their own slot from a shared link (planned for v2).
- Multi-room / resource booking.
- Calendar sync (bidirectional sync of all events) — we only read freebusy and create interview events.

## 8. Design Notes

- The availability checker UI should be a visual time grid (similar to Google Calendar's "Find a time" feature or Calendly-style slot picker).
- Show timezone clearly — recruiters often schedule across timezones.
- The "Schedule Interview" button should be prominent on the candidate profile, near the interview schedule section.
- Calendar connection status should be visible on the user settings page with a clear "Connect Google Calendar" / "Disconnect" toggle.

## 9. Open Questions

- Should we support scheduling interviews with multiple interviewers in sequence (e.g., a 4-hour onsite loop with different interviewers per slot)? (Recommendation: v2. For v1, each interview is a single event with all interviewers in the same room.)
- Should the candidate receive a custom-branded email invitation in addition to the Google Calendar invite? (Recommendation: No for v1 — rely on the Google Calendar invitation which already includes all details.)
- Should we support recurring interviews (e.g., weekly check-in)? (Recommendation: No — interviews are one-off events.)
