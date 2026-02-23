# TRD-02: Candidate Scorecard / Dashboard

## 1. Overview

Add a unified candidate scorecard widget to the existing profile page and a standalone Kanban pipeline board. This requires schema changes for stage tracking, new API endpoints, and a lightweight frontend SPA for the board.

## 2. Architecture

```
┌──────────────────────┐        ┌─────────────────────┐
│  Pipeline Board SPA  │ ◄────► │  enrichment-service  │
│  (React / Vue)       │  REST  │  /v1/pipeline/*      │
└──────────────────────┘        │  /v1/candidates/*    │
                                └─────────────────────┘
                                        │
                                  MySQL (shared)
                                        │
                                ┌──────────────┐
                                │   OpenCATS   │
                                │  (scorecard  │
                                │   widget)    │
                                └──────────────┘
```

The pipeline board is a standalone SPA (served as static files by the enrichment service or a CDN). The scorecard widget is embedded in the existing OpenCATS candidate profile via PHP template.

## 3. Data Model

### 3.1 Schema Changes to `candidate` Table

Add columns to the existing `candidate` table:

```sql
ALTER TABLE candidate
  ADD COLUMN candidate_stage ENUM(
    'applied', 'phone_screen', 'onsite', 'offer', 'hired', 'rejected'
  ) DEFAULT 'applied' AFTER status,
  ADD COLUMN stage_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER candidate_stage,
  ADD COLUMN source VARCHAR(100) DEFAULT NULL AFTER stage_changed_at;
```

### 3.2 New Table: `candidate_stage_history`

Tracks every stage transition for audit and velocity calculations.

```sql
CREATE TABLE candidate_stage_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id INT NOT NULL,
  job_id INT DEFAULT NULL,
  from_stage VARCHAR(50) DEFAULT NULL,
  to_stage VARCHAR(50) NOT NULL,
  changed_by_user_id INT NOT NULL,
  change_reason TEXT DEFAULT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_stage_history_candidate (candidate_id),
  INDEX idx_stage_history_job (job_id),
  INDEX idx_stage_history_date (changed_at)
);
```

### 3.3 New Table: `pipeline_stages` (Admin-Configurable)

```sql
CREATE TABLE pipeline_stages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id INT DEFAULT NULL COMMENT 'NULL = global default stages',
  stage_key VARCHAR(50) NOT NULL,
  stage_label VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_terminal BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  color_hex VARCHAR(7) DEFAULT '#6B7280',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE INDEX idx_stage_job_key (job_id, stage_key)
);
```

Seed data:

```sql
INSERT INTO pipeline_stages (job_id, stage_key, stage_label, sort_order, is_terminal, color_hex) VALUES
  (NULL, 'applied',      'Applied',       1, FALSE, '#3B82F6'),
  (NULL, 'phone_screen', 'Phone Screen',  2, FALSE, '#8B5CF6'),
  (NULL, 'onsite',       'Onsite',        3, FALSE, '#F59E0B'),
  (NULL, 'offer',        'Offer',         4, FALSE, '#10B981'),
  (NULL, 'hired',        'Hired',         5, TRUE,  '#059669'),
  (NULL, 'rejected',     'Rejected',      6, TRUE,  '#EF4444');
```

## 4. API Endpoints (enrichment-service)

### 4.1 Get Pipeline for a Job

`GET /v1/pipeline/:jobId`

Returns all candidates for the given job grouped by stage, with card-level data.

**Query params:**
- `source` (optional): Filter by source.
- `feedback_status` (optional): `complete`, `pending`, `none`.
- `stale_days` (optional): Only candidates in stage longer than N days.
- `sort_by` (optional): `date_added` (default), `feedback_score`, `name`.

**Response:**
```json
{
  "job_id": 456,
  "stages": [
    {
      "stage_key": "applied",
      "stage_label": "Applied",
      "color_hex": "#3B82F6",
      "is_terminal": false,
      "candidate_count": 12,
      "avg_days_in_stage": 3.2,
      "candidates": [
        {
          "candidate_id": 123,
          "name": "Bob Jones",
          "stage_entered_at": "2026-02-20T10:00:00Z",
          "days_in_stage": 3,
          "is_stale": false,
          "source": "linkedin",
          "feedback_score": 4.2,
          "feedback_status": "complete"
        }
      ]
    }
  ]
}
```

### 4.2 Move Candidate Stage

`PATCH /v1/pipeline/:jobId/candidates/:candidateId/stage`

**Request:**
```json
{
  "to_stage": "phone_screen",
  "reason": "Passed resume screen"
}
```

**Response:**
```json
{
  "candidate_id": 123,
  "from_stage": "applied",
  "to_stage": "phone_screen",
  "stage_changed_at": "2026-02-23T15:00:00Z"
}
```

**Side effects:**
- Updates `candidate.candidate_stage` and `candidate.stage_changed_at`.
- Inserts record into `candidate_stage_history`.
- Creates activity log entry.

### 4.3 Get Candidate Scorecard

`GET /v1/candidates/:candidateId/scorecard`

Returns all scorecard data in a single payload (aggregated from multiple tables).

**Response:**
```json
{
  "candidate_id": 123,
  "name": "Bob Jones",
  "email": "bob@example.com",
  "phone": "+1-555-0123",
  "linkedin_url": "https://linkedin.com/in/bobjones",
  "location": "San Francisco, CA",
  "stage": {
    "current": "onsite",
    "label": "Onsite",
    "color_hex": "#F59E0B",
    "days_in_stage": 2,
    "total_days_in_pipeline": 14,
    "history": [
      { "stage": "applied", "entered_at": "2026-02-09", "exited_at": "2026-02-12", "days": 3 },
      { "stage": "phone_screen", "entered_at": "2026-02-12", "exited_at": "2026-02-21", "days": 9 },
      { "stage": "onsite", "entered_at": "2026-02-21", "exited_at": null, "days": 2 }
    ]
  },
  "feedback_summary": {
    "total_requested": 4,
    "total_submitted": 2,
    "average_score": 4.1,
    "recommendations": { "hire": 1, "no_hire": 0, "maybe": 1 }
  },
  "upcoming_interviews": [
    { "event_id": "evt_001", "date": "2026-02-24T14:00:00Z", "interviewer": "Alice Smith", "type": "Technical" }
  ],
  "past_interviews": [
    { "event_id": "evt_002", "date": "2026-02-21T10:00:00Z", "interviewer": "Charlie Brown", "type": "Phone Screen", "feedback_submitted": true }
  ],
  "source": "linkedin",
  "recent_activity": [
    { "type": "stage_change", "description": "Moved to Onsite", "user": "Recruiter Jane", "at": "2026-02-21T09:00:00Z" },
    { "type": "feedback", "description": "Feedback submitted by Charlie Brown — hire (4.5/5)", "at": "2026-02-21T11:00:00Z" }
  ]
}
```

### 4.4 Get / Update Pipeline Stages (Admin)

`GET /v1/pipeline/stages?job_id=456`

Returns configured stages for a job (or global defaults if no job-specific stages exist).

`PUT /v1/pipeline/stages`

**Request:**
```json
{
  "job_id": null,
  "stages": [
    { "stage_key": "applied", "stage_label": "Applied", "sort_order": 1, "is_terminal": false, "color_hex": "#3B82F6" },
    { "stage_key": "take_home", "stage_label": "Take-Home", "sort_order": 2, "is_terminal": false, "color_hex": "#6366F1" }
  ]
}
```

## 5. Pipeline Board SPA

### 5.1 Technology Choice

Lightweight React app (Create React App or Vite) with:
- `react-beautiful-dnd` (or `@hello-pangea/dnd`) for drag-and-drop.
- Fetch API for REST calls to enrichment-service.
- CSS Modules or Tailwind CSS for styling.

### 5.2 Build & Deployment

- Source: `enrichment-service/client/` directory.
- Build output: `enrichment-service/client/build/`.
- Served by Express as static files at `/pipeline`.
- Route: `GET /pipeline` → serves `index.html` (client-side routing handles `?job_id=X`).

### 5.3 Components

```
<App>
  <BoardHeader>         — Job title, filters, sort controls
  <StageColumn>         — One per stage
    <CandidateCard>     — Draggable card
  <ScorecardPanel>      — Slide-out detail panel
```

### 5.4 State Management

- Board state fetched from `GET /v1/pipeline/:jobId` on load.
- Drag-and-drop triggers optimistic local state update + `PATCH /v1/pipeline/:jobId/candidates/:candidateId/stage`.
- On API failure: revert local state, show toast error.
- Polling: Refresh board data every 30 seconds (or WebSocket in v2).

## 6. Scorecard Widget (OpenCATS PHP)

### 6.1 Implementation

New view template: `opencats-module/src/Views/scorecard_widget.php`

- Included in the existing candidate profile page via PHP `include`.
- On page load, makes an AJAX call to `GET /v1/candidates/:candidateId/scorecard`.
- Renders sections: stage badge, contact block, feedback summary, interview schedule, velocity timeline, source, activity log.
- Inline JS (~100 lines) for AJAX fetch + DOM rendering. No framework dependency.

### 6.2 Stage Change from Scorecard

- Stage badge is a clickable dropdown.
- Selecting a new stage calls `PATCH /v1/pipeline/:jobId/candidates/:candidateId/stage`.
- If stage is "Rejected", show a modal prompting for a reason (optional in v1).

## 7. Security

- Pipeline endpoints require Bearer token auth (internal service token or session-based auth passed from OpenCATS).
- Stage changes are audited in `candidate_stage_history` with `changed_by_user_id`.
- Admin-only endpoints (`PUT /v1/pipeline/stages`) require admin role check.

## 8. Performance

- `GET /v1/pipeline/:jobId` may return 100+ candidates. Use pagination for large pipelines:
  - Default: First 50 candidates per stage.
  - "Load more" button per column.
- Scorecard endpoint joins across 4-5 tables. Use MySQL query optimization:
  - Index on `candidate_id` for all related tables.
  - Consider a materialized scorecard cache (Redis) if latency exceeds 500ms.

## 9. Testing Plan

### Unit Tests
- Stage transition validation (cannot move from "Hired" back to "Applied" — configurable rule).
- Scorecard aggregation logic.
- Stage history recording.

### Integration Tests
- Full pipeline fetch with filters and sorting.
- Drag-and-drop stage change → DB verification.
- Scorecard endpoint returns correct data after feedback submission.

### Frontend Tests
- Drag-and-drop reorder and cross-column move.
- Filter and sort controls update displayed cards.
- Slide-out panel opens with correct candidate data.
- Optimistic update reverts on API error.

### QA Scenarios
- Pipeline with 200+ candidates loads within 2 seconds.
- Two recruiters drag the same candidate simultaneously (last-write-wins with toast notification).
- Admin adds a new stage; existing candidates remain in their current stage.

## 10. Migration & Rollout

1. Run SQL migration: add columns to `candidate`, create `candidate_stage_history` and `pipeline_stages` tables, seed default stages.
2. Backfill: Set all existing candidates to `candidate_stage = 'applied'` (or infer from existing status if possible).
3. Deploy enrichment service with new endpoints.
4. Build and deploy pipeline board SPA.
5. Add scorecard widget to OpenCATS candidate profile template.
6. Enable for one recruiter as pilot → gather feedback → iterate.
7. GA rollout.
