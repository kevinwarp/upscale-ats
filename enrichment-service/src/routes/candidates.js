const express = require('express');
const multer = require('multer');
const pipelineService = require('../services/pipelineService');
const inputParser = require('../services/inputParser');
const csvImporter = require('../services/csvImporter');
const db = require('../db');
const logger = require('../utils/logger');

const router = express.Router();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

/**
 * GET /v1/candidates/:candidateId/scorecard
 */
router.get('/:candidateId/scorecard', async (req, res) => {
  try {
    const candidateId = parseInt(req.params.candidateId);
    const scorecard = await pipelineService.getScorecard(candidateId);

    if (!scorecard) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json(scorecard);
  } catch (err) {
    logger.error('Failed to get scorecard', { error: err.message });
    res.status(500).json({ error: 'Failed to get scorecard' });
  }
});

/**
 * POST /v1/candidates/quick-add
 */
router.post('/quick-add', async (req, res) => {
  try {
    const { input, job_id, source } = req.body;

    if (!input || !input.trim()) {
      return res.status(400).json({ error: 'input is required' });
    }

    const parsed = inputParser.detectInputType(input.trim());
    let candidateData = {};

    switch (parsed.type) {
      case 'linkedin_url': {
        const li = inputParser.parseLinkedInUrl(parsed.url);
        candidateData = {
          linkedin_url: li.linkedin_url,
          first_name: li.name_guess?.split(' ')[0] || '',
          last_name: li.name_guess?.split(' ').slice(1).join(' ') || '',
          source: source || 'linkedin',
        };
        break;
      }
      case 'email': {
        candidateData = {
          email: parsed.email,
          first_name: '',
          last_name: '',
          source: source || 'manual',
        };
        break;
      }
      case 'name_email': {
        const parts = parsed.name.split(' ');
        candidateData = {
          first_name: parts[0] || '',
          last_name: parts.slice(1).join(' ') || '',
          email: parsed.email,
          source: source || 'manual',
        };
        break;
      }
      case 'resume_text': {
        const resume = inputParser.parseResumeText(parsed.text);
        const nameParts = (resume.name || '').split(' ');
        candidateData = {
          first_name: nameParts[0] || '',
          last_name: nameParts.slice(1).join(' ') || '',
          email: resume.email,
          phone: resume.phone,
          company: resume.company,
          source: source || 'resume',
        };
        break;
      }
      case 'name_only': {
        const nameParts = parsed.name.split(' ');
        candidateData = {
          first_name: nameParts[0] || '',
          last_name: nameParts.slice(1).join(' ') || '',
          source: source || 'manual',
        };
        break;
      }
      default:
        return res.status(400).json({ error: 'Could not parse input. Provide a LinkedIn URL, email, name+email, or resume text.' });
    }

    // Duplicate check
    if (candidateData.email) {
      const [existing] = await db.query(
        'SELECT candidate_id FROM candidate WHERE email1 = ? LIMIT 1',
        [candidateData.email]
      );
      if (existing.length > 0) {
        return res.status(409).json({
          error: 'duplicate_candidate',
          existing_candidate_id: existing[0].candidate_id,
          matched_on: 'email',
          profile_url: `/candidates/${existing[0].candidate_id}`,
        });
      }
    }

    if (candidateData.linkedin_url) {
      const [existing] = await db.query(
        'SELECT candidate_id FROM candidate WHERE web_site = ? LIMIT 1',
        [candidateData.linkedin_url]
      );
      if (existing.length > 0) {
        return res.status(409).json({
          error: 'duplicate_candidate',
          existing_candidate_id: existing[0].candidate_id,
          matched_on: 'linkedin_url',
          profile_url: `/candidates/${existing[0].candidate_id}`,
        });
      }
    }

    // Insert candidate
    const [result] = await db.query(
      `INSERT INTO candidate
        (first_name, last_name, email1, phone_home, web_site, current_employer,
         candidate_stage, stage_changed_at, source, enrichment_status, date_created, site_id)
       VALUES (?, ?, ?, ?, ?, ?, 'applied', NOW(), ?, 'pending', NOW(), 1)`,
      [
        candidateData.first_name || '',
        candidateData.last_name || '',
        candidateData.email || null,
        candidateData.phone || null,
        candidateData.linkedin_url || null,
        candidateData.company || null,
        candidateData.source || 'manual',
      ]
    );

    const candidateId = result.insertId;
    const fullName = [candidateData.first_name, candidateData.last_name].filter(Boolean).join(' ');

    logger.info('Quick-add candidate created', { candidateId, inputType: parsed.type });

    res.status(201).json({
      candidate_id: candidateId,
      name: fullName,
      email: candidateData.email || null,
      linkedin_url: candidateData.linkedin_url || null,
      source: candidateData.source,
      input_type: parsed.type,
      enrichment_status: 'pending',
      profile_url: `/candidates/${candidateId}`,
    });
  } catch (err) {
    logger.error('Quick-add failed', { error: err.message });
    res.status(500).json({ error: 'Failed to create candidate' });
  }
});

/**
 * POST /v1/candidates/import
 */
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    const userId = parseInt(req.headers['x-user-id']) || 0;
    const jobId = req.body.job_id ? parseInt(req.body.job_id) : null;
    const defaultSource = req.body.source || 'csv_import';

    const importJob = await csvImporter.startImport(
      req.file.buffer,
      req.file.originalname,
      userId,
      jobId,
      defaultSource
    );

    res.status(202).json({
      import_job_id: importJob.id,
      total_rows: importJob.total_rows,
      status: 'processing',
      status_url: `/v1/candidates/import/${importJob.id}/status`,
    });
  } catch (err) {
    logger.error('Import failed', { error: err.message });
    res.status(500).json({ error: 'Failed to start import' });
  }
});

/**
 * GET /v1/candidates/import/:importJobId/status
 */
router.get('/import/:importJobId/status', async (req, res) => {
  try {
    const status = await csvImporter.getImportStatus(req.params.importJobId);
    if (!status) {
      return res.status(404).json({ error: 'Import job not found' });
    }
    res.json(status);
  } catch (err) {
    logger.error('Failed to get import status', { error: err.message });
    res.status(500).json({ error: 'Failed to get import status' });
  }
});

/**
 * GET /v1/candidates/import/:importJobId/results.csv
 */
router.get('/import/:importJobId/results.csv', async (req, res) => {
  try {
    const csv = await csvImporter.getResultsCsv(req.params.importJobId);
    if (!csv) {
      return res.status(404).json({ error: 'Import job not found' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import-${req.params.importJobId}-results.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error('Failed to get import results', { error: err.message });
    res.status(500).json({ error: 'Failed to get import results' });
  }
});

module.exports = router;
