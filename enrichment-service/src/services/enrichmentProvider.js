const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Find a personal email for a candidate using the configured enrichment provider.
 *
 * This is provider-agnostic. To add a new provider, implement a handler function
 * and register it in the PROVIDERS map below.
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
  const providerName = config.provider.name;
  const handler = PROVIDERS[providerName];

  if (!handler) {
    logger.warn('No enrichment provider configured or provider not recognized', {
      provider: providerName,
    });
    return {
      status: 'error',
      personal_email: null,
      confidence: 0,
      source: providerName,
      provider_metadata: { error: `Provider "${providerName}" is not configured. Set ENRICHMENT_PROVIDER in your environment.` },
      latency_ms: 0,
    };
  }

  return handler(params);
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

/**
 * Stub provider — returns no_match. Used when no real provider is configured.
 */
async function noneProvider(_params) {
  return {
    status: 'no_match',
    personal_email: null,
    confidence: 0,
    source: 'none',
    provider_metadata: { message: 'No enrichment provider configured. Set ENRICHMENT_PROVIDER to enable.' },
    latency_ms: 0,
  };
}

/**
 * Generic HTTP provider — calls a configurable REST endpoint.
 * Suitable for Apollo, Hunter, Clearbit, or any provider with a JSON API.
 *
 * Expects the provider endpoint to accept a POST with the candidate params
 * and return a JSON response with { email, confidence } at minimum.
 */
async function customProvider(params) {
  const startTime = Date.now();

  try {
    logger.info('Calling enrichment provider', {
      provider: 'custom',
      endpoint: config.provider.endpoint,
      hasLinkedIn: !!params.linkedin_url,
      hasName: !!params.full_name,
    });

    const response = await axios.post(
      config.provider.endpoint,
      {
        full_name: params.full_name || null,
        linkedin_url: params.linkedin_url || null,
        company: params.company || null,
        company_domain: params.company_domain || null,
        location: params.location || null,
        work_email: params.work_email || null,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.provider.apiKey}`,
        },
        timeout: config.provider.timeoutMs,
      }
    );

    const latencyMs = Date.now() - startTime;
    return normalizeResponse(response.data, 'custom', latencyMs);
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      logger.error('Enrichment provider timeout', { latencyMs });
      return {
        status: 'error',
        personal_email: null,
        confidence: 0,
        source: 'custom',
        provider_metadata: { error: 'timeout' },
        latency_ms: latencyMs,
      };
    }

    logger.error('Enrichment provider error', {
      status: error.response?.status,
      message: error.message,
      latencyMs,
    });

    return {
      status: 'error',
      personal_email: null,
      confidence: 0,
      source: 'custom',
      provider_metadata: {
        error: error.response?.data?.message || error.message,
        http_status: error.response?.status,
      },
      latency_ms: latencyMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Provider registry — add new providers here
// ---------------------------------------------------------------------------

const PROVIDERS = {
  none: noneProvider,
  custom: customProvider,
  // Future providers:
  // apollo: apolloProvider,
  // hunter: hunterProvider,
  // clearbit: clearbitProvider,
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a provider response into the standardized format.
 */
function normalizeResponse(data, source, latencyMs) {
  const email = data?.personal_email || data?.email || null;
  const confidence = data?.confidence || 0;

  if (!email) {
    return {
      status: 'no_match',
      personal_email: null,
      confidence: 0,
      source,
      provider_metadata: redactMetadata(data),
      latency_ms: latencyMs,
    };
  }

  return {
    status: 'found',
    personal_email: email,
    confidence: normalizeConfidence(confidence),
    source,
    provider_metadata: redactMetadata(data),
    latency_ms: latencyMs,
  };
}

/**
 * Normalize confidence to a 0-1 float.
 */
function normalizeConfidence(value) {
  if (typeof value !== 'number') return 0;
  if (value > 1) return Math.min(value / 100, 1);
  return Math.max(0, Math.min(value, 1));
}

/**
 * Strip sensitive signals from provider metadata before returning/storing.
 */
function redactMetadata(data) {
  if (!data) return {};
  return {
    match_reason: data.match_reason || null,
    signals: Array.isArray(data.signals) ? data.signals : [],
  };
}

module.exports = {
  findPersonalEmail,
  // Exported for testing
  normalizeResponse,
  normalizeConfidence,
  redactMetadata,
  PROVIDERS,
};
