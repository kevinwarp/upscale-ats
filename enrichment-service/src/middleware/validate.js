const logger = require('../utils/logger');

/**
 * Validate the enrichment request body.
 * Requires at least full_name or linkedin_url.
 */
function validateEnrichmentRequest(req, res, next) {
  const { candidate_id, full_name, linkedin_url } = req.body;

  const errors = [];

  if (!candidate_id) {
    errors.push('candidate_id is required');
  }

  if (!full_name && !linkedin_url) {
    errors.push('At least one of full_name or linkedin_url is required');
  }

  if (linkedin_url && typeof linkedin_url === 'string') {
    const linkedInPattern = /^https?:\/\/(www\.)?linkedin\.com\/in\/.+/i;
    if (!linkedInPattern.test(linkedin_url)) {
      errors.push('linkedin_url must be a valid LinkedIn profile URL');
    }
  }

  if (errors.length > 0) {
    logger.warn('Validation failed', { errors, body: req.body });
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  next();
}

module.exports = { validateEnrichmentRequest };
