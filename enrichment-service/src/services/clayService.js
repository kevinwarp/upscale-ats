const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Call Clay.com API to find a personal email for a candidate.
 *
 * @param {Object} params
 * @param {string} [params.full_name]
 * @param {string} [params.linkedin_url]
 * @param {string} [params.company]
 * @param {string} [params.company_domain]
 * @param {string} [params.location]
 * @param {string} [params.work_email]
 * @returns {Object} Standardized enrichment result
 */
async function findPersonalEmail(params) {
  const startTime = Date.now();

  const requestPayload = {
    workflow_id: config.clay.workflowId,
    inputs: {
      full_name: params.full_name || null,
      linkedin_url: params.linkedin_url || null,
      company: params.company || null,
      company_domain: params.company_domain || null,
      location: params.location || null,
      work_email: params.work_email || null,
    },
  };

  try {
    logger.info('Calling Clay API', {
      endpoint: config.clay.apiEndpoint,
      hasLinkedIn: !!params.linkedin_url,
      hasName: !!params.full_name,
    });

    const response = await axios.post(
      `${config.clay.apiEndpoint}/enrich`,
      requestPayload,
      {
        headers: buildAuthHeaders(),
        timeout: config.clay.timeoutMs,
      }
    );

    const latencyMs = Date.now() - startTime;
    return normalizeClayResponse(response.data, latencyMs);
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      logger.error('Clay API timeout', { latencyMs });
      return {
        status: 'error',
        personal_email: null,
        confidence: 0,
        source: 'clay',
        provider_metadata: { error: 'timeout' },
        latency_ms: latencyMs,
      };
    }

    logger.error('Clay API error', {
      status: error.response?.status,
      message: error.message,
      latencyMs,
    });

    return {
      status: 'error',
      personal_email: null,
      confidence: 0,
      source: 'clay',
      provider_metadata: {
        error: error.response?.data?.message || error.message,
        http_status: error.response?.status,
      },
      latency_ms: latencyMs,
    };
  }
}

/**
 * Build authorization headers for Clay API.
 */
function buildAuthHeaders() {
  if (config.clay.authMethod === 'oauth') {
    return {
      Authorization: `Bearer ${config.clay.apiKey}`,
      'Content-Type': 'application/json',
    };
  }
  // Default: API key header
  return {
    'X-Api-Key': config.clay.apiKey,
    'Content-Type': 'application/json',
  };
}

/**
 * Normalize Clay's response into our standardized format.
 * NOTE: Field mappings here are placeholders — update once Clay API docs are confirmed.
 */
function normalizeClayResponse(data, latencyMs) {
  // Clay response structure is TBD — adapt these field paths
  const email = data?.personal_email || data?.results?.[0]?.email || null;
  const confidence = data?.confidence || data?.results?.[0]?.confidence || 0;
  const matchReason = data?.match_reason || data?.results?.[0]?.match_reason || null;

  if (!email) {
    return {
      status: 'no_match',
      personal_email: null,
      confidence: 0,
      source: 'clay',
      provider_metadata: redactMetadata(data),
      latency_ms: latencyMs,
    };
  }

  return {
    status: 'found',
    personal_email: email,
    confidence: normalizeConfidence(confidence),
    source: 'clay',
    provider_metadata: redactMetadata(data),
    latency_ms: latencyMs,
  };
}

/**
 * Normalize confidence to a 0-1 float.
 */
function normalizeConfidence(value) {
  if (typeof value !== 'number') return 0;
  // If Clay returns 0-100, normalize to 0-1
  if (value > 1) return Math.min(value / 100, 1);
  return Math.max(0, Math.min(value, 1));
}

/**
 * Strip sensitive signals from provider metadata before returning/storing.
 */
function redactMetadata(data) {
  if (!data) return {};
  // Keep only safe fields — extend as needed
  return {
    match_reason: data.match_reason || null,
    signals: Array.isArray(data.signals) ? data.signals : [],
  };
}

module.exports = {
  findPersonalEmail,
  // Exported for testing
  normalizeClayResponse,
  normalizeConfidence,
  redactMetadata,
  buildAuthHeaders,
};
