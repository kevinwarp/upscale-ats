-- Migration: Add tables for pipeline, feedback, calendar, and quick-add features
-- Version: 002
-- Date: 2026-02-23

-- ============================================================================
-- Candidate table additions
-- ============================================================================
ALTER TABLE candidate
  ADD COLUMN candidate_stage ENUM(
    'applied', 'phone_screen', 'onsite', 'offer', 'hired', 'rejected'
  ) DEFAULT 'applied',
  ADD COLUMN stage_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN source VARCHAR(100) DEFAULT NULL,
  ADD COLUMN enrichment_status ENUM('none', 'pending', 'completed', 'failed') DEFAULT 'none';

CREATE INDEX idx_candidate_stage ON candidate (candidate_stage);
CREATE INDEX idx_candidate_source ON candidate (source);

-- ============================================================================
-- Pipeline stages (admin-configurable)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_stages (
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

INSERT INTO pipeline_stages (job_id, stage_key, stage_label, sort_order, is_terminal, color_hex) VALUES
  (NULL, 'applied',      'Applied',       1, FALSE, '#3B82F6'),
  (NULL, 'phone_screen', 'Phone Screen',  2, FALSE, '#8B5CF6'),
  (NULL, 'onsite',       'Onsite',        3, FALSE, '#F59E0B'),
  (NULL, 'offer',        'Offer',         4, FALSE, '#10B981'),
  (NULL, 'hired',        'Hired',         5, TRUE,  '#059669'),
  (NULL, 'rejected',     'Rejected',      6, TRUE,  '#EF4444');

-- ============================================================================
-- Candidate stage history (audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS candidate_stage_history (
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

-- ============================================================================
-- Import jobs (CSV bulk import tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_jobs (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  rows_processed INT NOT NULL DEFAULT 0,
  rows_created INT NOT NULL DEFAULT 0,
  rows_duplicate INT NOT NULL DEFAULT 0,
  rows_error INT NOT NULL DEFAULT 0,
  status ENUM('processing', 'completed', 'failed') DEFAULT 'processing',
  result_data JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,
  INDEX idx_import_user (user_id),
  INDEX idx_import_status (status)
);

-- ============================================================================
-- Interview feedback
-- ============================================================================
CREATE TABLE IF NOT EXISTS interview_feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id INT NOT NULL,
  job_id INT DEFAULT NULL,
  interviewer_user_id INT NOT NULL,
  interviewer_name VARCHAR(255) DEFAULT NULL,
  interviewer_email VARCHAR(255) DEFAULT NULL,
  candidate_name VARCHAR(255) DEFAULT NULL,
  job_title VARCHAR(255) DEFAULT NULL,
  event_id VARCHAR(255) DEFAULT NULL COMMENT 'Calendar event ID if linked',

  score_technical TINYINT DEFAULT NULL,
  score_communication TINYINT DEFAULT NULL,
  score_culture_fit TINYINT DEFAULT NULL,
  score_problem_solving TINYINT DEFAULT NULL,

  recommendation ENUM('hire', 'no_hire', 'maybe') DEFAULT NULL,
  notes TEXT DEFAULT NULL,

  status ENUM('draft', 'submitted', 'locked') DEFAULT 'draft',
  submitted_at DATETIME DEFAULT NULL,
  locked_at DATETIME DEFAULT NULL,
  reminder_sent BOOLEAN DEFAULT FALSE,

  access_token VARCHAR(64) NOT NULL UNIQUE,
  token_expires_at DATETIME NOT NULL,

  slack_thread_ts VARCHAR(64) DEFAULT NULL,
  slack_message_ts VARCHAR(64) DEFAULT NULL,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_feedback_candidate (candidate_id),
  INDEX idx_feedback_job (job_id),
  INDEX idx_feedback_interviewer (interviewer_user_id),
  INDEX idx_feedback_token (access_token),
  INDEX idx_feedback_status (status)
);

-- ============================================================================
-- Feedback Slack threads (thread per candidate+job)
-- ============================================================================
CREATE TABLE IF NOT EXISTS feedback_slack_threads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id INT NOT NULL,
  job_id INT DEFAULT NULL,
  slack_channel_id VARCHAR(64) NOT NULL,
  slack_thread_ts VARCHAR(64) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_thread_candidate_job (candidate_id, job_id)
);

-- ============================================================================
-- User integrations (OAuth tokens for Google Calendar, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_integrations (
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

-- ============================================================================
-- Interview events
-- ============================================================================
CREATE TABLE IF NOT EXISTS interview_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id INT NOT NULL,
  job_id INT DEFAULT NULL,
  google_event_id VARCHAR(255) DEFAULT NULL,
  interview_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  timezone VARCHAR(50) DEFAULT 'UTC',
  location VARCHAR(255) DEFAULT NULL,
  meet_link VARCHAR(500) DEFAULT NULL,

  organizer_user_id INT NOT NULL,
  candidate_email VARCHAR(255) DEFAULT NULL,

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

-- ============================================================================
-- Interview event participants (many-to-many)
-- ============================================================================
CREATE TABLE IF NOT EXISTS interview_event_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  response_status ENUM('needsAction', 'accepted', 'declined', 'tentative') DEFAULT 'needsAction',
  UNIQUE INDEX idx_event_user (event_id, user_id),
  INDEX idx_participant_user (user_id)
);
