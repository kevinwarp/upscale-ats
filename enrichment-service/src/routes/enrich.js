const express = require('express');
const { validateEnrichmentRequest } = require('../middleware/validate');
const { candidateCooldown, recordEnrichment } = require('../middleware/rateLimiter');
const clayService = require('../services/clayService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /v1/enrich/personal-email
 *
 * Enrich a candidate with their personal email via Clay.com.
 */
router.post(
  '/personal-email',
  validateEnrichmentRequest,
  candidateCooldown,
  async (req, res) => {
    const { candidate_id, full_name, linkedin_url, company, company_domain, location, work_email } =
      req.body;

    const userId = req.headers['x-user-id'] || 'unknown';

    logger.info('Enrichment request received', {
      candidateId: candidate_id,
      userId,
      hasLinkedIn: !!linkedin_url,
      hasName: !!full_name,
    });

    try {
      const result = await clayService.findPersonalEmail({
        full_name,
        linkedin_url,
        company,
        company_domain,
        location,
        work_email,
      });

      // Record cooldown on any non-error result
      if (result.status !== 'error') {
        recordEnrichment(candidate_id);
      }

      logger.info('Enrichment result', {
        candidateId: candidate_id,
        status: result.status,
        confidence: result.confidence,
        latencyMs: result.latency_ms,
      });

      return res.json(result);
    } catch (error) {
      logger.error('Unexpected enrichment error', {
        candidateId: candidate_id,
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        status: 'error',
        personal_email: null,
        confidence: 0,
        source: 'clay',
        provider_metadata: { error: 'Internal server error' },
        latency_ms: 0,
      });
    }
  }
);

module.exports = router;
