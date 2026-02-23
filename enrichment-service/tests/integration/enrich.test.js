const request = require('supertest');
const app = require('../../src/index');

// Mock the enrichment provider to avoid real API calls in tests
jest.mock('../../src/services/enrichmentProvider', () => ({
  findPersonalEmail: jest.fn(),
}));

const enrichmentProvider = require('../../src/services/enrichmentProvider');
const { _clearCooldownCache } = require('../../src/middleware/rateLimiter');

const VALID_TOKEN = process.env.ATS_ENRICHMENT_TOKEN || 'test-token';

// Override config for tests
jest.mock('../../src/config', () => ({
  port: 3001,
  nodeEnv: 'test',
  logLevel: 'error',
  provider: {
    name: 'none',
    apiKey: 'test-key',
    endpoint: 'https://api.example.com/v1',
    timeoutMs: 10000,
  },
  enrichmentToken: 'test-token',
  rateLimits: {
    perUserPerDay: 1000,
    globalPerDay: 5000,
    candidateCooldownDays: 7,
  },
  dailyCostCapUsd: 50,
}));

describe('POST /v1/enrich/personal-email', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearCooldownCache();
  });

  const validBody = {
    candidate_id: 'c123',
    full_name: 'Alice Smith',
    linkedin_url: 'https://linkedin.com/in/alicesmith',
  };

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/v1/enrich/personal-email')
      .send(validBody);

    expect(res.status).toBe(401);
  });

  it('returns 403 with invalid token', async () => {
    const res = await request(app)
      .post('/v1/enrich/personal-email')
      .set('Authorization', 'Bearer wrong-token')
      .send(validBody);

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid request body', async () => {
    const res = await request(app)
      .post('/v1/enrich/personal-email')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ candidate_id: 'c123' }); // missing name and linkedin

    expect(res.status).toBe(400);
  });

  it('returns found email on success', async () => {
    enrichmentProvider.findPersonalEmail.mockResolvedValue({
      status: 'found',
      personal_email: 'alice@gmail.com',
      confidence: 0.85,
      source: 'test',
      provider_metadata: { match_reason: 'linkedin' },
      latency_ms: 150,
    });

    const res = await request(app)
      .post('/v1/enrich/personal-email')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('X-User-Id', 'user1')
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('found');
    expect(res.body.personal_email).toBe('alice@gmail.com');
    expect(res.body.confidence).toBe(0.85);
  });

  it('returns no_match when provider finds nothing', async () => {
    enrichmentProvider.findPersonalEmail.mockResolvedValue({
      status: 'no_match',
      personal_email: null,
      confidence: 0,
      source: 'none',
      provider_metadata: {},
      latency_ms: 200,
    });

    const res = await request(app)
      .post('/v1/enrich/personal-email')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_match');
  });

  it('returns error when provider fails', async () => {
    enrichmentProvider.findPersonalEmail.mockResolvedValue({
      status: 'error',
      personal_email: null,
      confidence: 0,
      source: 'custom',
      provider_metadata: { error: 'timeout' },
      latency_ms: 10000,
    });

    const res = await request(app)
      .post('/v1/enrich/personal-email')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('error');
  });

  it('health check responds without auth', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
