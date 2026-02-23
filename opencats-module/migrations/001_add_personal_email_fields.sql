-- Migration: Add personal email enrichment fields to candidate table
-- Version: 001
-- Date: 2026-02-23
-- Description: Adds columns for storing Clay.com email enrichment results

ALTER TABLE candidate
  ADD COLUMN personal_email VARCHAR(255) DEFAULT NULL
    COMMENT 'Personal email address found via enrichment',
  ADD COLUMN personal_email_status ENUM('unverified', 'verified', 'no_match', 'error') DEFAULT NULL
    COMMENT 'Status of the personal email enrichment result',
  ADD COLUMN personal_email_confidence FLOAT DEFAULT NULL
    COMMENT 'Confidence score 0-1 from enrichment provider',
  ADD COLUMN personal_email_provider VARCHAR(64) DEFAULT 'clay'
    COMMENT 'Provider that supplied the personal email',
  ADD COLUMN personal_email_last_enriched_at DATETIME DEFAULT NULL
    COMMENT 'Timestamp of last enrichment attempt',
  ADD COLUMN personal_email_enrichment_payload TEXT DEFAULT NULL
    COMMENT 'JSON payload from enrichment provider (redacted)';

-- Index for lookup by enrichment status
CREATE INDEX idx_candidate_personal_email_status
  ON candidate (personal_email_status);

-- Index for cooldown queries
CREATE INDEX idx_candidate_personal_email_last_enriched
  ON candidate (personal_email_last_enriched_at);
