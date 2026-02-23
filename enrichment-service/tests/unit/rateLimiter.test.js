const { candidateCooldown, recordEnrichment, _clearCooldownCache } = require('../../src/middleware/rateLimiter');

describe('candidateCooldown', () => {
  let req, res, next;

  beforeEach(() => {
    _clearCooldownCache();
    req = { body: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('allows request when no prior enrichment exists', () => {
    req.body = { candidate_id: 'c1' };
    candidateCooldown(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks request within cooldown window', () => {
    recordEnrichment('c2');
    req.body = { candidate_id: 'c2' };
    candidateCooldown(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows request when no candidate_id is provided', () => {
    req.body = {};
    candidateCooldown(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
