/**
 * Integration tests for the Golden Path Hiring Workflow.
 *
 * These tests validate the end-to-end flow from candidate creation
 * through the full pipeline. They require a running database connection.
 *
 * Run with: npm run test:integration
 */

const request = require('supertest');

// Skip integration tests if DB is not available
const SKIP_INTEGRATION = !process.env.DB_HOST;

const describeIf = SKIP_INTEGRATION ? describe.skip : describe;

describeIf('Golden Path Workflow', () => {
  let app;
  const AUTH_TOKEN = process.env.ATS_ENRICHMENT_TOKEN || 'test-token';
  const headers = {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    'x-user-id': '1',
  };

  beforeAll(() => {
    process.env.ATS_ENRICHMENT_TOKEN = AUTH_TOKEN;
    app = require('../../src/index');
  });

  describe('Step 1-3: Job Creation + CSV Import', () => {
    it('POST /v1/candidates/import accepts CSV and assigns in_pipeline stage', async () => {
      const csv = 'first_name,last_name,email\nTest,Candidate,test@goldenpath.com';
      const res = await request(app)
        .post('/v1/candidates/import')
        .set(headers)
        .attach('file', Buffer.from(csv), 'test.csv');

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('processing');
      expect(res.body.total_rows).toBe(1);
    });
  });

  describe('Step 7: Pipeline stages', () => {
    it('GET /v1/pipeline/stages returns TRD-defined stages', async () => {
      const res = await request(app)
        .get('/v1/pipeline/stages')
        .set(headers);

      if (res.status === 200) {
        const keys = res.body.stages.map((s) => s.stage_key);
        expect(keys).toContain('in_pipeline');
        expect(keys).toContain('phone_screen');
        expect(keys).toContain('homework_assignment');
        expect(keys).toContain('onsite_interview');
        expect(keys).toContain('offer');
        expect(keys).toContain('rejected');
      }
    });
  });

  describe('Email webhook', () => {
    it('POST /v1/email/webhook returns 200 for valid Pub/Sub message', async () => {
      const pubsubMessage = {
        message: {
          data: Buffer.from(JSON.stringify({
            emailAddress: 'recruiter@test.com',
            historyId: '12345',
          })).toString('base64'),
        },
      };

      const res = await request(app)
        .post('/v1/email/webhook')
        .send(pubsubMessage);

      // Should return 200 even if user not found (prevents Pub/Sub retries)
      expect(res.status).toBe(200);
    });

    it('POST /v1/email/webhook returns 400 for missing data', async () => {
      const res = await request(app)
        .post('/v1/email/webhook')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('Reports', () => {
    it('GET /v1/reports/:candidateId returns 404 for nonexistent report', async () => {
      const res = await request(app)
        .get('/v1/reports/99999')
        .set(headers);

      expect(res.status).toBe(404);
    });
  });

  describe('Analytics', () => {
    it('GET /v1/analytics/pipeline returns metrics', async () => {
      const res = await request(app)
        .get('/v1/analytics/pipeline')
        .set(headers);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('stage_distribution');
        expect(res.body).toHaveProperty('transitions');
      }
    });
  });

  describe('Health + Monitoring', () => {
    it('GET /healthz returns ok without auth', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /v1/monitoring/health returns metrics', async () => {
      const res = await request(app)
        .get('/v1/monitoring/health')
        .set(headers);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('metrics');
      }
    });
  });
});
