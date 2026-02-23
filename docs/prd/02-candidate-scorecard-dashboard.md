# PRD-02: Candidate Scorecard / Dashboard

## 1. Problem Statement

Recruiters and hiring managers lack a single place to understand where a candidate stands. Key information — interview stage, feedback scores, contact details, upcoming interviews, and source attribution — is scattered across database tables, email threads, and external tools. This forces users to click through multiple screens and mentally stitch together a candidate's status, slowing down decisions and increasing the chance of candidates falling through the cracks.

## 2. Goal

Deliver a unified candidate scorecard that surfaces all critical candidate data in a single view, and a Kanban-style pipeline board that gives recruiters a visual overview of all candidates for a given job, enabling faster triage and fewer dropped candidates.

## 3. Success Metrics

- Recruiter time-to-answer "Where does candidate X stand?" decreases by ≥50% (measured via session analytics or user survey).
- ≥95% of active candidates have an accurate stage assignment at all times.
- Pipeline board adoption: ≥80% of recruiters use the board at least once per day within 2 weeks of launch.
- Candidate drop-off rate (candidates stuck in a stage >14 days without action) decreases by ≥25%.

## 4. Target Users

- **Recruiter**: Primary user. Manages day-to-day pipeline, moves candidates through stages, monitors velocity.
- **Hiring Manager**: Reviews pipeline health per job, checks candidate scorecards before making decisions.
- **Admin**: Configures pipeline stages and default views.

## 5. User Stories

### Recruiter
- As a recruiter, I open a candidate's profile and immediately see their current stage, overall feedback score, upcoming interviews, and contact info — without navigating away.
- As a recruiter, I open the pipeline board for a job and see all candidates arranged by stage in a Kanban layout, so I can quickly identify bottlenecks.
- As a recruiter, I drag a candidate card from one stage column to the next, and the system records the stage change with a timestamp.
- As a recruiter, I filter the pipeline board by source (e.g., referral, LinkedIn, job board) to evaluate sourcing channel effectiveness.
- As a recruiter, I see a "stale" badge on candidates who haven't moved stages in >7 days.

### Hiring Manager
- As a hiring manager, I open the pipeline board and see how many candidates are in each stage, plus the average time-in-stage, so I can assess hiring velocity.
- As a hiring manager, I click a candidate card on the board and see their scorecard in a slide-out panel without leaving the board.

### Admin
- As an admin, I customize the pipeline stages (add, rename, reorder, or hide stages) per job or globally.
- As an admin, I set the "stale candidate" threshold (default: 7 days).

## 6. Requirements

### 6.1 Candidate Scorecard (Profile Widget)

A new section on the existing candidate profile page displaying:

| Section | Content |
|---|---|
| **Stage Badge** | Current pipeline stage with color coding (e.g., green = Offer, red = Rejected). |
| **Contact Block** | Name, email, phone, LinkedIn URL, location. Pulled from existing candidate record + enrichment data. |
| **Feedback Summary** | Aggregate interview scores (from Feature 1), recommendation breakdown, completion status. |
| **Interview Schedule** | Upcoming and past interviews with date, interviewer, and status (from Feature 4 / calendar). |
| **Pipeline Velocity** | Days in current stage, total days in pipeline, stage history timeline. |
| **Source Attribution** | How the candidate entered the system (referral, job board, LinkedIn import, manual entry). |
| **Activity Log** | Recent activity: stage changes, feedback submissions, emails, enrichment events (last 10 entries). |

### 6.2 Pipeline Board (Kanban View)

A standalone page accessible at `/pipeline?job_id=X`.

- **Columns**: One per pipeline stage (default: Applied → Phone Screen → Onsite → Offer → Hired | Rejected).
- **Cards**: Each card shows candidate name, current stage duration, overall feedback score (if available), and source icon.
- **Drag-and-drop**: Move cards between columns to change stage. Confirm on drop. Auto-records `stage_changed_at`.
- **Filters**: By source, by feedback status (complete / pending / none), by days-in-stage range.
- **Sort**: Within each column, sort by date added (default), feedback score, or name.
- **Column metrics**: Count of candidates, average days-in-stage.
- **Stale indicator**: Visual badge on cards where `days_in_current_stage > STALE_THRESHOLD_DAYS`.
- **Quick-view**: Click a card to open the scorecard in a slide-out panel (no page navigation).
- **Responsive**: Works on tablet (≥768px). Mobile is out of scope for v1.

### 6.3 Stage Management

- Default stages: Applied, Phone Screen, Onsite, Offer, Hired, Rejected.
- Admin can add custom stages, reorder them, rename them, or mark as inactive.
- Stage changes are logged in the activity log with timestamp and user who made the change.
- "Hired" and "Rejected" are terminal stages — candidates in these stages are visually distinct (muted or separate section).

## 7. Out of Scope (v1)

- Multi-job pipeline view (aggregate board across all jobs).
- Automated stage transitions (e.g., auto-move to "Phone Screen" when phone screen is scheduled).
- Email/SMS outreach directly from the scorecard.
- Pipeline analytics dashboard (charts, conversion funnels) — planned for v2.
- Mobile-optimized pipeline board layout.

## 8. Design Notes

- The scorecard widget should load asynchronously to avoid slowing down the existing candidate profile page.
- The pipeline board should be a lightweight SPA (React or Vue) communicating with the enrichment service API.
- Drag-and-drop should use optimistic UI updates with server confirmation; revert on failure.
- Color-code stages consistently across scorecard badge and board columns.

## 9. Open Questions

- Should the pipeline board support multiple jobs in a single view? (Recommendation: No for v1; add in v2 as a "master pipeline".)
- Should stage changes require a reason/comment? (Recommendation: Optional for v1, required for "Rejected" stage.)
- Should we show salary/compensation data on the scorecard? (Recommendation: No — sensitive data, keep in a separate tab.)
