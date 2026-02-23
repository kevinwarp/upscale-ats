const request = require('supertest');

// Mock all DB and external service calls
jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getConnection: jest.fn().mockResolvedValue({
    beginTransaction: jest.fn(),
    execute: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  }),
  close: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  port: 3001,
  nodeEnv: 'test',
  logLevel: 'error',
  db: { host: 'localhost', port: 3306, user: 'test', password: 'test', name: 'test' },
  provider: { name: 'none', apiKey: '', endpoint: '', timeoutMs: 10000 },
  enrichmentToken: 'test-token',
  rateLimits: { perUserPerDay: 1000, globalPerDay: 5000, candidateCooldownDays: 7 },
  dailyCostCapUsd: 50,
  slack: { feedbackWebhookUrl: '', feedbackChannel: '#test', botToken: '' },
  feedback: { reminderHours: 24, lockHours: 48 },
  google: { clientId: '', clientSecret: '', redirectUri: '' },
  pipeline: { staleThresholdDays: 7 },
  baseUrl: 'http://localhost:8080',
}));

// Mock jobs to prevent setInterval in tests
jest.mock('../../src/jobs/feedbackReminder', () => ({ start: jest.fn(), run: jest.fn() }));
jest.mock('../../src/jobs/postInterviewCheck', () => ({ start: jest.fn(), run: jest.fn() }));

const db = require('../../src/db');
const app = require('../../src/index');

const TOKEN = 'test-token';

describe('Pipeline routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /v1/pipeline/stages', () => {
    it('returns stages', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, stage_key: 'applied', stage_label: 'Applied', sort_order: 1, is_terminal: false, color_hex: '#3B82F6', is_active: true },
      ]]);

      const res = await request(app)
        .get('/v1/pipeline/stages')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.stages).toHaveLength(1);
      expect(res.body.stages[0].stage_key).toBe('applied');
    });
  });

  describe('PATCH /v1/pipeline/:jobId/candidates/:candidateId/stage', () => {
    it('returns 400 without to_stage', async () => {
      const res = await request(app)
        .patch('/v1/pipeline/1/candidates/123/stage')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });
});

describe('Candidates routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /v1/candidates/quick-add', () => {
    it('returns 400 without input', async () => {
      const res = await request(app)
        .post('/v1/candidates/quick-add')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('creates candidate from LinkedIn URL', async () => {
      // Duplicate check returns empty
      db.query
        .mockResolvedValueOnce([[]]) // LinkedIn duplicate check
        .mockResolvedValueOnce([{ insertId: 42 }]); // Insert

      const res = await request(app)
        .post('/v1/candidates/quick-add')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ input: 'https://linkedin.com/in/bob-jones' });

      expect(res.status).toBe(201);
      expect(res.body.candidate_id).toBe(42);
      expect(res.body.input_type).toBe('linkedin_url');
    });

    it('returns 409 for duplicate email', async () => {
      db.query.mockResolvedValueOnce([[{ candidate_id: 10 }]]); // Email duplicate found

      const res = await request(app)
        .post('/v1/candidates/quick-add')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ input: 'Bob Jones bob@example.com' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('duplicate_candidate');
    });
  });
});

describe('Feedback routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /v1/feedback/request', () => {
    it('creates a feedback request', async () => {
      db.query.mockResolvedValueOnce([{ insertId: 1 }]);

      const res = await request(app)
        .post('/v1/feedback/request')
        .send({
          candidate_id: 123,
          interviewer_user_id: 456,
          interviewer_name: 'Alice',
          candidate_name: 'Bob',
        });

      expect(res.status).toBe(201);
      expect(res.body.feedback_id).toBe(1);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.form_url).toContain('/feedback/');
    });

    it('returns 400 without required fields', async () => {
      const res = await request(app)
        .post('/v1/feedback/request')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /v1/feedback/:token', () => {
    it('returns feedback data for valid token', async () => {
      db.query.mockResolvedValueOnce([[{
        id: 1, candidate_name: 'Bob', job_title: 'Engineer',
        interviewer_name: 'Alice', status: 'draft',
        score_technical: null, score_communication: null,
        score_culture_fit: null, score_problem_solving: null,
        recommendation: null, notes: null,
        token_expires_at: new Date(Date.now() + 86400000),
        candidate_id: 123, job_id: 456,
      }]]);

      const res = await request(app)
        .get('/v1/feedback/some-token')
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.candidate_name).toBe('Bob');
      expect(res.body.status).toBe('draft');
    });

    it('returns 404 for invalid token', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/v1/feedback/invalid-token')
        .set('Accept', 'application/json');

      expect(res.status).toBe(404);
    });
  });
});

describe('Calendar routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /v1/calendar/status', () => {
    it('returns connection status', async () => {
      db.query.mockResolvedValueOnce([[{
        is_active: true, created_at: '2026-02-20', scopes: 'calendar.readonly,calendar.events',
      }]]);

      const res = await request(app)
        .get('/v1/calendar/status')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('X-User-Id', '10');

      expect(res.status).toBe(200);
      expect(res.body.is_connected).toBe(true);
    });

    it('returns 400 without user id', async () => {
      const res = await request(app)
        .get('/v1/calendar/status')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.status).toBe(400);
    });
  });
});
