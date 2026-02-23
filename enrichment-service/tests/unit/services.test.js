const { starRating } = require('../../src/services/slackService');
const { calculateAvailableSlots } = require('../../src/services/calendarService');

// Mock db and config to prevent actual connections
jest.mock('../../src/db', () => ({
  query: jest.fn().mockResolvedValue([[]]),
  getConnection: jest.fn(),
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

describe('slackService', () => {
  describe('starRating', () => {
    it('generates correct star rating for 5', () => {
      const result = starRating(5);
      expect(result).toContain('⭐');
      expect(result).not.toContain('☆');
    });

    it('generates correct star rating for 3', () => {
      const result = starRating(3);
      expect(result.match(/⭐/g).length).toBe(3);
      expect(result.match(/☆/g).length).toBe(2);
    });

    it('generates correct star rating for 1', () => {
      const result = starRating(1);
      expect(result.match(/⭐/g).length).toBe(1);
      expect(result.match(/☆/g).length).toBe(4);
    });
  });
});

describe('calendarService', () => {
  describe('calculateAvailableSlots', () => {
    // Use a Monday (UTC) for testing working hours
    const monday9am = new Date('2026-02-23T09:00:00Z'); // Monday
    const monday5pm = new Date('2026-02-23T17:00:00Z');

    it('returns slots when no busy blocks', () => {
      const slots = calculateAvailableSlots({}, monday9am, monday5pm, 60);
      expect(slots.length).toBeGreaterThan(0);
    });

    it('excludes slots that overlap busy blocks', () => {
      const busyMap = {
        1: [{ start: '2026-02-23T10:00:00Z', end: '2026-02-23T11:00:00Z' }],
      };
      const slots = calculateAvailableSlots(busyMap, monday9am, monday5pm, 60);
      const tenAmSlot = slots.find((s) => s.start === '2026-02-23T10:00:00.000Z');
      expect(tenAmSlot).toBeUndefined();
    });

    it('merges overlapping busy blocks from multiple interviewers', () => {
      const busyMap = {
        1: [{ start: '2026-02-23T10:00:00Z', end: '2026-02-23T11:00:00Z' }],
        2: [{ start: '2026-02-23T10:30:00Z', end: '2026-02-23T11:30:00Z' }],
      };
      const slots = calculateAvailableSlots(busyMap, monday9am, monday5pm, 60);
      // 10:00-11:30 should be completely blocked
      const tenAmSlot = slots.find((s) => s.start === '2026-02-23T10:00:00.000Z');
      const tenThirtySlot = slots.find((s) => s.start === '2026-02-23T10:30:00.000Z');
      expect(tenAmSlot).toBeUndefined();
      expect(tenThirtySlot).toBeUndefined();
    });

    it('returns empty for weekend days', () => {
      const saturday = new Date('2026-02-28T09:00:00Z'); // Saturday
      const satEnd = new Date('2026-02-28T17:00:00Z');
      const slots = calculateAvailableSlots({}, saturday, satEnd, 60);
      expect(slots.length).toBe(0);
    });

    it('respects duration parameter', () => {
      const slots30 = calculateAvailableSlots({}, monday9am, monday5pm, 30);
      const slots60 = calculateAvailableSlots({}, monday9am, monday5pm, 60);
      expect(slots30.length).toBeGreaterThan(slots60.length);
    });
  });
});
