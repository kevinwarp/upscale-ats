-- Migration: Golden Path Hiring Workflow Automation
-- Version: 003
-- Date: 2026-02-23
-- Description: Extends schema for end-to-end hiring workflow automation
--              (Gmail ingestion, workflow engine, reports, enhanced Slack)

-- ============================================================================
-- Candidate table — expand stage ENUM and add workflow columns
-- ============================================================================

-- Expand candidate_stage to match TRD stage definitions
ALTER TABLE candidate
  MODIFY COLUMN candidate_stage ENUM(
    'in_pipeline',
    'phone_screen',
    'homework_assignment',
    'onsite_interview',
    'offer',
    'rejected'
  ) DEFAULT 'in_pipeline';

-- Migrate existing data to new stage values
UPDATE candidate SET candidate_stage = 'in_pipeline'       WHERE candidate_stage = 'applied';
UPDATE candidate SET candidate_stage = 'onsite_interview'   WHERE candidate_stage = 'onsite';
UPDATE candidate SET candidate_stage = 'offer'              WHERE candidate_stage = 'hired';

-- Add golden-path tracking columns
ALTER TABLE candidate
  ADD COLUMN outreach_sent       BOOLEAN DEFAULT FALSE   COMMENT 'Whether outreach email was sent',
  ADD COLUMN phone_screen_score  FLOAT   DEFAULT NULL    COMMENT 'Phone screen interview score (1-5)',
  ADD COLUMN homework_received   BOOLEAN DEFAULT FALSE   COMMENT 'Whether homework submission was received',
  ADD COLUMN onsite_avg_score    FLOAT   DEFAULT NULL    COMMENT 'Average onsite interview score',
  ADD COLUMN hire_recommendation ENUM('strong_hire','hire','no_hire','strong_no_hire') DEFAULT NULL
    COMMENT 'Final hiring recommendation',
  ADD COLUMN active_pipeline     BOOLEAN DEFAULT FALSE   COMMENT 'Candidate is actively in pipeline (confirmed)';

CREATE INDEX idx_candidate_active_pipeline ON candidate (active_pipeline);
CREATE INDEX idx_candidate_outreach        ON candidate (outreach_sent);

-- ============================================================================
-- Update default pipeline stages to match TRD
-- ============================================================================
DELETE FROM pipeline_stages WHERE job_id IS NULL;

INSERT INTO pipeline_stages (job_id, stage_key, stage_label, sort_order, is_terminal, color_hex) VALUES
  (NULL, 'in_pipeline',          'In Pipeline',          1, FALSE, '#3B82F6'),
  (NULL, 'phone_screen',         'Phone Screen',         2, FALSE, '#8B5CF6'),
  (NULL, 'homework_assignment',  'Homework Assignment',  3, FALSE, '#F59E0B'),
  (NULL, 'onsite_interview',     'Onsite Interview',     4, FALSE, '#F97316'),
  (NULL, 'offer',                'Offer',                5, FALSE, '#10B981'),
  (NULL, 'rejected',             'Rejected',             6, TRUE,  '#EF4444');

-- ============================================================================
-- Workflow events — audit log for all automated actions
-- ============================================================================
CREATE TABLE IF NOT EXISTS workflow_events (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id  INT          NOT NULL,
  job_id        INT          DEFAULT NULL,
  event_type    VARCHAR(100) NOT NULL COMMENT 'e.g. stage_transition, outreach_detected, feedback_submitted, report_generated',
  event_data    JSON         DEFAULT NULL COMMENT 'Structured event payload',
  source        VARCHAR(50)  NOT NULL DEFAULT 'system' COMMENT 'system | manual | gmail | calendar | slack',
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_wf_candidate  (candidate_id),
  INDEX idx_wf_job        (job_id),
  INDEX idx_wf_type       (event_type),
  INDEX idx_wf_created    (created_at)
);

-- ============================================================================
-- Email ingestion logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS email_ingestion_logs (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  gmail_message_id     VARCHAR(255) NOT NULL,
  thread_id            VARCHAR(255) DEFAULT NULL,
  from_addr            VARCHAR(255) NOT NULL,
  to_addrs             TEXT         DEFAULT NULL COMMENT 'Comma-separated',
  cc_addrs             TEXT         DEFAULT NULL COMMENT 'Comma-separated',
  subject              VARCHAR(500) DEFAULT NULL,
  direction            ENUM('inbound','outbound') NOT NULL,
  matched_candidate_id INT          DEFAULT NULL,
  match_method         VARCHAR(50)  DEFAULT NULL COMMENT 'email | subject_parse | manual',
  attachments          JSON         DEFAULT NULL COMMENT 'Array of {filename, mimeType, size}',
  processed_at         DATETIME     DEFAULT CURRENT_TIMESTAMP,
  status               ENUM('processed','unmatched','error','ignored') DEFAULT 'processed',
  error_message        TEXT         DEFAULT NULL,

  UNIQUE INDEX idx_email_gmail_id  (gmail_message_id),
  INDEX idx_email_candidate        (matched_candidate_id),
  INDEX idx_email_status           (status),
  INDEX idx_email_direction        (direction),
  INDEX idx_email_processed        (processed_at)
);

-- ============================================================================
-- Reports
-- ============================================================================
CREATE TABLE IF NOT EXISTS reports (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id    INT          NOT NULL,
  job_id          INT          DEFAULT NULL,
  report_type     VARCHAR(50)  NOT NULL DEFAULT 'onsite_summary' COMMENT 'onsite_summary | phone_screen | full',
  report_data     JSON         NOT NULL COMMENT 'Full structured report',
  generated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  delivered_to    JSON         DEFAULT NULL COMMENT 'Array of {channel, recipient, status}',
  delivery_status ENUM('pending','delivered','partial','failed') DEFAULT 'pending',

  INDEX idx_report_candidate (candidate_id),
  INDEX idx_report_job       (job_id),
  INDEX idx_report_type      (report_type)
);

-- ============================================================================
-- Slack messages — audit trail for all Slack messages sent
-- ============================================================================
CREATE TABLE IF NOT EXISTS slack_messages (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  channel_id    VARCHAR(64)  DEFAULT NULL,
  thread_ts     VARCHAR(64)  DEFAULT NULL,
  message_ts    VARCHAR(64)  DEFAULT NULL,
  message_type  VARCHAR(50)  NOT NULL COMMENT 'notification | feedback_request | reminder | escalation | report',
  candidate_id  INT          DEFAULT NULL,
  job_id        INT          DEFAULT NULL,
  payload       JSON         DEFAULT NULL,
  sent_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  status        ENUM('sent','failed','pending') DEFAULT 'pending',
  error_message TEXT         DEFAULT NULL,
  retry_count   INT          DEFAULT 0,

  INDEX idx_slack_candidate  (candidate_id),
  INDEX idx_slack_type       (message_type),
  INDEX idx_slack_status     (status),
  INDEX idx_slack_sent       (sent_at)
);
