# PRD-01: Interview Feedback + Slack Integration

## 1. Problem Statement

Interview feedback at most recruiting teams is unstructured and scattered — interviewers send notes via email, Slack DMs, or verbal debriefs. This creates three problems:

1. **Feedback is lost.** Notes live in personal inboxes and are never aggregated.
2. **Decisions are slow.** Hiring managers wait days to collect all interviewer opinions before making a call.
3. **There's no accountability.** No way to track who has or hasn't submitted feedback, leading to incomplete interview loops.

## 2. Goal

Provide a structured, time-boxed interview feedback system that captures standardized scores and recommendations from every interviewer, posts a formatted summary to Slack for team visibility, and aggregates results on the candidate profile for fast hiring decisions.

## 3. Success Metrics

- ≥90% of interviewers submit feedback within 24 hours of the interview.
- Average time-to-decision (from final interview to hire/reject) decreases by ≥30%.
- 100% of submitted feedback is posted to Slack within 5 seconds.
- ≥80% of hiring managers report improved visibility into candidate evaluations (survey).

## 4. Target Users

- **Interviewer**: Any employee who conducts a candidate interview.
- **Recruiter**: Manages the hiring pipeline; needs to see aggregated feedback.
- **Hiring Manager**: Makes the final hire/no-hire decision based on feedback.
- **Admin**: Configures Slack channels, feedback deadlines, and scoring rubrics.

## 5. User Stories

### Interviewer
- As an interviewer, I receive a feedback request (email + Slack DM) immediately after my interview ends, so I can submit feedback while it's fresh.
- As an interviewer, I complete a structured scorecard (rated categories + free-text notes + recommendation) in under 3 minutes.
- As an interviewer, I can save a draft and return to finish later before the deadline.

### Recruiter
- As a recruiter, I see which interviewers have and haven't submitted feedback on the candidate profile, so I can follow up.
- As a recruiter, I see the aggregated score and recommendation breakdown (hire/no-hire/maybe) at a glance.
- As a recruiter, I receive an alert when all feedback for a candidate's interview loop is complete.

### Hiring Manager
- As a hiring manager, I see a Slack summary in `#hiring` with all scores and recommendations after each feedback submission, so I can track progress in real time.
- As a hiring manager, I can view the full feedback detail (notes, scores, timestamps) on the candidate profile.

### Admin
- As an admin, I configure which Slack channel receives feedback posts.
- As an admin, I set the feedback reminder interval (default: 24h) and lock deadline (default: 48h).
- As an admin, I can customize scoring categories and scales per job or globally.

## 6. Requirements

### 6.1 Feedback Form

- Accessible via unique URL (token-based, no login required for external interviewers).
- **Scoring categories** (default, admin-customizable):
  - Technical Skills (1–5)
  - Communication (1–5)
  - Culture Fit (1–5)
  - Problem Solving (1–5)
- **Overall recommendation**: Hire / No Hire / Maybe (required).
- **Free-text notes**: Optional, max 5000 characters.
- **Draft saving**: Auto-save every 30 seconds; explicit "Save Draft" button.
- **Submission**: One-click submit; confirmation dialog; cannot edit after submission (but admin can unlock).
- **Time-boxing**:
  - Reminder sent at `FEEDBACK_REMINDER_HOURS` (default: 24h) if not submitted.
  - Form locks at `FEEDBACK_LOCK_HOURS` (default: 48h). After lock, only admin can re-open.

### 6.2 Feedback Request Delivery

- Triggered automatically when an interview event ends (from calendar integration) OR manually by recruiter clicking "Request Feedback" on candidate profile.
- Delivered via:
  - **Email**: To interviewer's work email with a direct link to the form.
  - **Slack DM** (if Slack integration is connected): Message with candidate name, role, and feedback link.

### 6.3 Slack Posting

- On each feedback submission, post a formatted message to the configured Slack channel.
- **Message format**:
  - Candidate name + role/job title
  - Interviewer name
  - Scores (visual bar or emoji-based)
  - Recommendation (Hire ✅ / No Hire ❌ / Maybe 🤔)
  - Link to full candidate profile
- **Threading**: All feedback for the same candidate + job should be posted as replies in a single Slack thread (keyed by `candidate_id + job_id`).
- When all interviewers in the loop have submitted, post a **summary message** to the thread with aggregated scores and the overall recommendation breakdown.

### 6.4 Aggregation & Display

- Candidate profile shows:
  - Per-interviewer feedback (scores, recommendation, notes, timestamp)
  - Aggregate scores (average per category)
  - Recommendation breakdown: X hire / Y no-hire / Z maybe
  - Completion status: 3 of 5 interviewers submitted
  - Overall status badge: "Complete", "Pending (2 outstanding)", "Overdue"

### 6.5 Notifications & Reminders

- Reminder to interviewer at configured interval if feedback not submitted.
- Notification to recruiter when:
  - Each feedback is submitted (optional, configurable).
  - All feedback for a candidate loop is complete.
  - Any feedback is overdue (past lock deadline without submission).

## 7. Out of Scope (v1)

- AI-generated feedback summaries or sentiment analysis.
- Video recording or transcription of interviews.
- External interviewer accounts (use token-based form links instead).
- Custom scoring scales beyond 1-5 (future: configurable rubrics).

## 8. Design Notes

- The feedback form should be mobile-friendly (interviewers may fill it out on their phone after an in-person interview).
- The Slack message should use Block Kit for rich formatting.
- Form links should expire after `FEEDBACK_LOCK_HOURS` and show a "Feedback window closed" message.

## 9. Open Questions

- Should feedback be anonymous to other interviewers? (Recommendation: No for internal teams, configurable for panel interviews.)
- Should we support scoring rubric templates per job? (Recommendation: v2, use global defaults for v1.)
- Should the summary message include free-text notes or just scores? (Recommendation: Scores only in Slack; full notes on the candidate profile for privacy.)
