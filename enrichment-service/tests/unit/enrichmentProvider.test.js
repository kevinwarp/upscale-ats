const {
  normalizeResponse,
  normalizeConfidence,
  redactMetadata,
  PROVIDERS,
} = require('../../src/services/enrichmentProvider');

describe('enrichmentProvider', () => {
  describe('normalizeResponse', () => {
    it('returns "found" when email is present', () => {
      const data = { personal_email: 'alice@gmail.com', confidence: 0.85, match_reason: 'linkedin' };
      const result = normalizeResponse(data, 'test-provider', 120);

      expect(result.status).toBe('found');
      expect(result.personal_email).toBe('alice@gmail.com');
      expect(result.confidence).toBe(0.85);
      expect(result.source).toBe('test-provider');
      expect(result.latency_ms).toBe(120);
    });

    it('returns "found" when email field is named "email"', () => {
      const data = { email: 'bob@yahoo.com', confidence: 72 };
      const result = normalizeResponse(data, 'test-provider', 200);

      expect(result.status).toBe('found');
      expect(result.personal_email).toBe('bob@yahoo.com');
      expect(result.confidence).toBe(0.72);
    });

    it('returns "no_match" when no email is found', () => {
      const data = {};
      const result = normalizeResponse(data, 'test-provider', 300);

      expect(result.status).toBe('no_match');
      expect(result.personal_email).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('returns "no_match" for null data', () => {
      const result = normalizeResponse(null, 'test-provider', 50);

      expect(result.status).toBe('no_match');
      expect(result.personal_email).toBeNull();
    });
  });

  describe('normalizeConfidence', () => {
    it('passes through 0-1 values', () => {
      expect(normalizeConfidence(0.5)).toBe(0.5);
      expect(normalizeConfidence(0)).toBe(0);
      expect(normalizeConfidence(1)).toBe(1);
    });

    it('normalizes 0-100 values to 0-1', () => {
      expect(normalizeConfidence(85)).toBe(0.85);
      expect(normalizeConfidence(100)).toBe(1);
    });

    it('returns 0 for non-number values', () => {
      expect(normalizeConfidence('high')).toBe(0);
      expect(normalizeConfidence(null)).toBe(0);
      expect(normalizeConfidence(undefined)).toBe(0);
    });

    it('clamps negative values to 0', () => {
      expect(normalizeConfidence(-0.5)).toBe(0);
    });
  });

  describe('redactMetadata', () => {
    it('keeps only safe fields', () => {
      const data = {
        match_reason: 'linkedin_match',
        signals: ['email_verified'],
        secret_field: 'sensitive_data',
        internal_score: 99,
      };
      const result = redactMetadata(data);

      expect(result.match_reason).toBe('linkedin_match');
      expect(result.signals).toEqual(['email_verified']);
      expect(result.secret_field).toBeUndefined();
      expect(result.internal_score).toBeUndefined();
    });

    it('returns empty object for null data', () => {
      expect(redactMetadata(null)).toEqual({});
    });
  });

  describe('PROVIDERS', () => {
    it('has a "none" provider registered', () => {
      expect(PROVIDERS.none).toBeDefined();
      expect(typeof PROVIDERS.none).toBe('function');
    });

    it('has a "custom" provider registered', () => {
      expect(PROVIDERS.custom).toBeDefined();
      expect(typeof PROVIDERS.custom).toBe('function');
    });

    it('"none" provider returns no_match', async () => {
      const result = await PROVIDERS.none({ full_name: 'Test User' });
      expect(result.status).toBe('no_match');
      expect(result.source).toBe('none');
    });
  });
});
