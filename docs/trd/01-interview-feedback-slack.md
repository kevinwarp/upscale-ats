# TRD-01: Interview Feedback + Slack Integration

## 1. Overview

Add structured interview feedback capture to Upscale-ATS with automatic Slack posting. This feature spans the enrichment service (new feedback endpoints), the OpenCATS PHP module (UI + data model), and a new Slack integration layer.

## 2. Architecture

```
┌──────────────┐  POST feedback   ┌─────────────────────┐  POST webhook   ┌─────────┐
│  Feedback    │ ───────────────► │  enrichment-service  │ ──────────────► │  Slack  │
│  Form (Web)  │                  │  /v1/feedback/*      │                 │   API   │
└──────────────┘                  └─────────────────────┘                  └─────────┘
                                          │
                                    MySQL (shared)
                                          │
                                  ┌──────────────┐
                                  │   OpenCATS   │
                                  │  (read/display)│
                                  └──────────────┘
```

## 3. Data Model

### 3.1 New Table: `interview_feedback`

```sql
CREATE TABLE interview_feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id INT NOT NULL,
  job_id INT DEFAULT NULL,
  interviewer_user_id INT NOT NULL,
  event_id VARCHAR(255) DEFAULT NULL COMMENT 'Calendar event ID if linked',

  -- Scores (1-5 scale)
  score_technical TINYINT DEFAULT NULL CHECK (score_technical BETWEEN 1 AND 5),
  score_communication TINYINT DEFAULT NULL CHECK (score_communication BETWEEN 1 AND 5),
  score_culture_fit TINYINT DEFAULT NULL CHECK (score_culture_fit BETWEEN 1 AND 5),
  score_problem_solving TINYINT DEFAULT NULL CHECK (score_problem_solving BETWEEN 1 AND 5),

  -- Recommendation
  recommendation ENUM('hire', 'no_hire', 'maybe') NOT NULL,

  -- Notes
  notes TEXT DEFAULT NULL,

  -- Status
  status ENUM('draft', 'submitted', 'locked') DEFAULT 'draft',
  submitted_at DATETIME DEFAULT NULL,
  locked_at DATETIME DEFAULT NULL,

  -- Token for form access (no-login submission)
  access_token VARCHAR(64) NOT NULL UNIQUE,
  token_expires_at DATETIME NOT NULL,

  -- Slack
  slack_thread_ts VARCHAR(64) DEFAULT NULL COMMENT 'Slack thread timestamp for threading',
  slack_message_ts VARCHAR(64) DEFAULT NULL COMMENT 'Slack message timestamp of this post',

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_feedback_candidate (candidate_id),
  INDEX idx_feedback_job (job_id),
  INDEX idx_feedback_interviewer (interviewer_user_id),
  INDEX idx_feedback_token (access_token),
  INDEX idx_feedback_status (status)
);
```

### 3.2 New Table: `feedback_slack_threads`

Tracks the Slack thread per candidate+job so subsequent feedback replies in the same thread.

```sql
CREATE TABLE feedback_slack_threads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id INT NOT NULL,
  job_id INT DEFAULT NULL,
  slack_channel_id VARCHAR(64) NOT NULL,
  slack_thread_ts VARCHAR(64) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE INDEX idx_thread_candidate_job (candidate_id, job_id)
);
```

## 4. API Endpoints (enrichment-service)

### 4.1 Create Feedback Request

`POST /v1/feedback/request`

Creates a feedback record with a unique access token and sends notifications.

**Request:**
```json
{
  "candidate_id": 123,
  "job_id": 456,
  "interviewer_user_id": 789,
  "interviewer_email": "alice@company.com",
  "interviewer_name": "Alice Smith",
  "candidate_name": "Bob Jones",
  "job_title": "Senior Engineer",
  "event_id": "google_cal_event_123"
}
```

**Response:**
```json
{
  "feedback_id": 1,
  "access_token": "a1b2c3d4...",
  "form_url": "https://ats.company.com/feedback/a1b2c3d4...",
  "expires_at": "2026-02-25T05:00:00Z"
}
```

**Side effects:**
- Sends email to `interviewer_email` with `form_url`.
- Sends Slack DM to interviewer (if `SLACK_BOT_TOKEN` is configured and user is mapped).

### 4.2 Get Feedback Form Data

`GET /v1/feedback/:token`

Returns the feedback form state for rendering. No auth required (token-based).

**Response:**
```json
{
  "feedback_id": 1,
  "candidate_name": "Bob Jones",
  "job_title": "Senior Engineer",
  "interviewer_name": "Alice Smith",
  "status": "draft",
  "scores": { "technical": null, "communication": null, "culture_fit": null, "problem_solving": null },
  "recommendation": null,
  "notes": "",
  "expires_at": "2026-02-25T05:00:00Z",
  "is_expired": false
}
```

### 4.3 Save Draft

`PATCH /v1/feedback/:token`

Auto-save or explicit draft save. Idempotent.

**Request:**
```json
{
  "scores": { "technical": 4, "communication": 3 },
  "recommendation": null,
  "notes": "Strong on system design..."
}
```

### 4.4 Submit Feedback

`POST /v1/feedback/:token/submit`

Finalizes the feedback. Cannot be undone by the interviewer.

**Request:**
```json
{
  "scores": { "technical": 4, "communication": 3, "culture_fit": 4, "problem_solving": 5 },
  "recommendation": "hire",
  "notes": "Strong on system design. Would be great for the infra team."
}
```

**Validation:**
- All four scores required (1-5).
- Recommendation required.
- Token must not be expired.
- Status must be `draft`.

**Side effects:**
1. Set `status = 'submitted'`, `submitted_at = NOW()`.
2. Post to Slack (see §5).
3. Check if all interviewers for this candidate+job have submitted → if yes, post summary to Slack thread.
4. Notify recruiter of submission.

### 4.5 Get Feedback Summary (for candidate profile)

`GET /v1/feedback/summary/:candidateId?job_id=456`

**Auth:** Bearer token (internal service call).

**Response:**
```json
{
  "candidate_id": 123,
  "job_id": 456,
  "total_requested": 5,
  "total_submitted": 3,
  "total_overdue": 1,
  "average_scores": {
    "technical": 3.7,
    "communication": 4.0,
    "culture_fit": 3.3,
    "problem_solving": 4.3
  },
  "overall_average": 3.83,
  "recommendations": { "hire": 2, "no_hire": 0, "maybe": 1 },
  "feedback": [
    {
      "interviewer_name": "Alice Smith",
      "scores": { "technical": 4, "communication": 3, "culture_fit": 4, "problem_solving": 5 },
      "recommendation": "hire",
      "notes": "Strong on system design...",
      "submitted_at": "2026-02-23T14:30:00Z"
    }
  ],
  "pending": [
    { "interviewer_name": "Charlie Brown", "requested_at": "2026-02-23T10:00:00Z", "is_overdue": true }
  ]
}
```

## 5. Slack Integration

### 5.1 Configuration

```
SLACK_FEEDBACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../xxx
SLACK_FEEDBACK_CHANNEL=#hiring
SLACK_BOT_TOKEN=xoxb-...  (optional, for DMs and threading)
FEEDBACK_REMINDER_HOURS=24
FEEDBACK_LOCK_HOURS=48
```

### 5.2 Individual Feedback Post

On each submission, post to the configured channel. Use Slack Block Kit.

**Message structure:**
- **Header**: "Interview Feedback: {Candidate Name} — {Job Title}"
- **Section**: Interviewer: {name}
- **Fields**: Score bars for each category (e.g., `Technical: ⭐⭐⭐⭐☆ (4/5)`)
- **Section**: Recommendation: ✅ Hire / ❌ No Hire / 🤔 Maybe
- **Context**: Submitted at {time} · {X of Y} feedback received
- **Action**: "View Profile" button linking to candidate profile

If a thread already exists for this candidate+job, post as a reply (`thread_ts`). Otherwise, create a new message and store the `thread_ts`.

### 5.3 Summary Post

When all interviewers have submitted (or after lock deadline), post a summary to the thread:

- **Header**: "📊 All Feedback In: {Candidate Name}"
- **Fields**: Average scores per category, overall average
- **Section**: Recommendation breakdown (2 hire / 1 maybe / 0 no-hire)
- **Context**: "All 3 interviewers have submitted feedback"

### 5.4 Slack Service Module

New file: `enrichment-service/src/services/slackService.js`

Methods:
- `postFeedback(feedbackData)` — posts individual feedback message
- `postSummary(candidateId, jobId)` — posts aggregated summary
- `sendDM(slackUserId, message)` — sends feedback request DM
- `getOrCreateThread(candidateId, jobId)` — manages thread lookup/creation

## 6. Feedback Form (Frontend)

### 6.1 Approach

Static HTML page served by the enrichment service at `GET /feedback/:token` (renders the form). Alternatively, a lightweight React/Vue SPA.

For MVP: Server-rendered HTML with vanilla JS for auto-save and submission. No framework dependency.

### 6.2 Form Behavior

- On load: `GET /v1/feedback/:token` to populate current state.
- Auto-save: `PATCH /v1/feedback/:token` every 30 seconds if changes detected.
- Submit: `POST /v1/feedback/:token/submit` with validation.
- Post-submit: Show "Thank you" confirmation, disable form.
- Expired: Show "Feedback window closed" message with contact info.

## 7. Reminder / Lock Cron

### 7.1 Approach

A cron job (or `setInterval` in the enrichment service for MVP) that runs every hour:

1. Find all `interview_feedback` records where `status = 'draft'`.
2. If `created_at + FEEDBACK_REMINDER_HOURS` has passed and no reminder sent → send reminder (email + Slack DM), set flag.
3. If `token_expires_at` has passed → set `status = 'locked'`, notify recruiter.

### 7.2 Implementation

New file: `enrichment-service/src/jobs/feedbackReminder.js`

For MVP, use `setInterval` in `index.js`. For production, migrate to a proper job queue (Bull/BullMQ with Redis).

## 8. OpenCATS PHP Module Changes

### 8.1 Candidate Profile — Feedback Section

New view template: `opencats-module/src/Views/feedback_section.php`

- Calls `GET /v1/feedback/summary/:candidateId` on page load.
- Displays aggregate scores, recommendation breakdown, completion status.
- "Request Feedback" button → calls `POST /v1/feedback/request`.
- Expandable rows per interviewer showing full detail.

### 8.2 Activity Log

Each feedback submission creates an activity log entry:
"Interview feedback submitted by {interviewer} — recommendation: {hire/no_hire/maybe} — avg score: {X}/5"

## 9. Security

- Access tokens: 64-char random hex, single-use per interviewer+candidate+job.
- Tokens expire after `FEEDBACK_LOCK_HOURS`.
- No PII in Slack messages beyond candidate name and interviewer name.
- Notes are NOT posted to Slack (privacy) — only scores and recommendation.
- Form URLs use HTTPS only.

## 10. Testing Plan

### Unit Tests
- Token generation and expiration logic
- Score validation (1-5 range, all required on submit)
- Slack message formatting
- Summary aggregation math
- Draft save idempotency

### Integration Tests
- Full flow: request → draft → submit → Slack post (mocked)
- Expired token rejection
- Duplicate submission prevention
- Reminder job picks up correct records

### QA Scenarios
- Interviewer submits on mobile
- Interviewer saves draft, closes browser, returns next day
- All interviewers submit → summary posts to Slack thread
- Feedback form accessed after lock deadline
- Recruiter requests feedback for candidate with no job association

## 11. Migration & Rollout

1. Run SQL migration to create `interview_feedback` and `feedback_slack_threads` tables.
2. Deploy enrichment service with new endpoints.
3. Configure `SLACK_FEEDBACK_WEBHOOK_URL` in `.env`.
4. Enable "Request Feedback" button on candidate profile.
5. Pilot with one hiring loop (1 recruiter + 3-4 interviewers).
6. Iterate on Slack message format based on team feedback.
7. GA rollout.
