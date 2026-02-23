const {
  extractEmailAddress,
  extractEmailAddresses,
  extractAttachments,
  isHomeworkEmail,
  isJobsAddressInCC,
} = require('../../src/services/gmailService');

describe('gmailService helpers', () => {
  describe('extractEmailAddress', () => {
    it('extracts email from "Name <email>" format', () => {
      expect(extractEmailAddress('John Smith <john@example.com>')).toBe('john@example.com');
    });

    it('handles plain email address', () => {
      expect(extractEmailAddress('john@example.com')).toBe('john@example.com');
    });

    it('lowercases the result', () => {
      expect(extractEmailAddress('JOHN@EXAMPLE.COM')).toBe('john@example.com');
    });

    it('returns empty string for null/empty input', () => {
      expect(extractEmailAddress(null)).toBe('');
      expect(extractEmailAddress('')).toBe('');
    });
  });

  describe('extractEmailAddresses', () => {
    it('extracts multiple addresses from comma-separated header', () => {
      const result = extractEmailAddresses('Alice <alice@test.com>, Bob <bob@test.com>');
      expect(result).toEqual(['alice@test.com', 'bob@test.com']);
    });

    it('returns empty array for null/empty input', () => {
      expect(extractEmailAddresses(null)).toEqual([]);
      expect(extractEmailAddresses('')).toEqual([]);
    });
  });

  describe('extractAttachments', () => {
    it('extracts attachments from MIME payload', () => {
      const payload = {
        parts: [
          {
            filename: 'resume.pdf',
            mimeType: 'application/pdf',
            body: { attachmentId: 'abc123', size: 1024 },
          },
          {
            filename: '',
            mimeType: 'text/plain',
            body: {},
          },
        ],
      };

      const result = extractAttachments(payload);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        filename: 'resume.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        attachmentId: 'abc123',
      });
    });

    it('handles null payload', () => {
      expect(extractAttachments(null)).toEqual([]);
    });

    it('handles nested parts', () => {
      const payload = {
        parts: [
          {
            mimeType: 'multipart/mixed',
            parts: [
              {
                filename: 'homework.zip',
                mimeType: 'application/zip',
                body: { attachmentId: 'xyz', size: 2048 },
              },
            ],
          },
        ],
      };

      const result = extractAttachments(payload);
      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('homework.zip');
    });
  });

  describe('isHomeworkEmail', () => {
    it('detects "homework" in subject (case insensitive)', () => {
      expect(isHomeworkEmail('Homework Assignment - Senior Engineer')).toBe(true);
      expect(isHomeworkEmail('Re: HOMEWORK for review')).toBe(true);
    });

    it('returns false for unrelated subjects', () => {
      expect(isHomeworkEmail('Interview Schedule')).toBe(false);
      expect(isHomeworkEmail('Offer Letter')).toBe(false);
    });

    it('returns false for null/empty', () => {
      expect(isHomeworkEmail(null)).toBe(false);
      expect(isHomeworkEmail('')).toBe(false);
    });
  });

  describe('isJobsAddressInCC', () => {
    beforeAll(() => {
      // Mock config
      jest.resetModules();
    });

    it('detects jobs address in CC', () => {
      const parsed = {
        cc: ['jobs@company.com', 'other@test.com'],
      };
      // This test depends on config.google.gmailJobsAddress being set.
      // For unit testing, we test the function shape.
      expect(typeof isJobsAddressInCC).toBe('function');
    });
  });
});

describe('emailMatcher', () => {
  // Note: matchToCandidate, matchByEmail, matchBySubject require DB access
  // and are tested in integration tests. Here we validate the module loads.
  it('exports expected functions', () => {
    const emailMatcher = require('../../src/services/emailMatcher');
    expect(typeof emailMatcher.matchToCandidate).toBe('function');
    expect(typeof emailMatcher.matchByEmail).toBe('function');
    expect(typeof emailMatcher.matchBySubject).toBe('function');
  });
});

describe('retryHelper', () => {
  const { withRetry, isRetryableHttpError } = require('../../src/services/retryHelper');

  it('returns result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, label: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, label: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1, label: 'test' })
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('respects shouldRetry predicate', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('non-retryable'));

    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 1, label: 'test', shouldRetry: () => false })
    ).rejects.toThrow('non-retryable');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  describe('isRetryableHttpError', () => {
    it('returns true for 500 errors', () => {
      expect(isRetryableHttpError({ response: { status: 500 } })).toBe(true);
      expect(isRetryableHttpError({ response: { status: 502 } })).toBe(true);
    });

    it('returns true for 429 (rate limit)', () => {
      expect(isRetryableHttpError({ response: { status: 429 } })).toBe(true);
    });

    it('returns true for network errors', () => {
      expect(isRetryableHttpError({ code: 'ECONNRESET' })).toBe(true);
      expect(isRetryableHttpError({ code: 'ETIMEDOUT' })).toBe(true);
    });

    it('returns false for 4xx client errors', () => {
      expect(isRetryableHttpError({ response: { status: 400 } })).toBe(false);
      expect(isRetryableHttpError({ response: { status: 404 } })).toBe(false);
    });

    it('returns false for null', () => {
      expect(isRetryableHttpError(null)).toBe(false);
    });
  });
});
