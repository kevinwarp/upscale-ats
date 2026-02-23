const { validateEnrichmentRequest } = require('../../src/middleware/validate');

describe('validateEnrichmentRequest', () => {
  let req, res, next;

  beforeEach(() => {
    req = { body: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('passes validation with candidate_id and full_name', () => {
    req.body = { candidate_id: '123', full_name: 'Alice Smith' };
    validateEnrichmentRequest(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes validation with candidate_id and linkedin_url', () => {
    req.body = { candidate_id: '123', linkedin_url: 'https://linkedin.com/in/alicesmith' };
    validateEnrichmentRequest(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('fails when candidate_id is missing', () => {
    req.body = { full_name: 'Alice Smith' };
    validateEnrichmentRequest(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails when neither full_name nor linkedin_url provided', () => {
    req.body = { candidate_id: '123' };
    validateEnrichmentRequest(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('fails with invalid linkedin_url', () => {
    req.body = { candidate_id: '123', linkedin_url: 'https://twitter.com/alice' };
    validateEnrichmentRequest(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('passes with all optional fields', () => {
    req.body = {
      candidate_id: '123',
      full_name: 'Alice Smith',
      linkedin_url: 'https://www.linkedin.com/in/alicesmith',
      company: 'Acme Corp',
      company_domain: 'acme.com',
      location: 'San Francisco, CA',
      work_email: 'alice@acme.com',
    };
    validateEnrichmentRequest(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
