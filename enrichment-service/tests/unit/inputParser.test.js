const { detectInputType, parseLinkedInUrl, parseResumeText } = require('../../src/services/inputParser');

describe('inputParser', () => {
  describe('detectInputType', () => {
    it('detects LinkedIn URL', () => {
      const result = detectInputType('https://linkedin.com/in/bobjones');
      expect(result.type).toBe('linkedin_url');
      expect(result.url).toBe('https://linkedin.com/in/bobjones');
    });

    it('detects LinkedIn URL with www', () => {
      const result = detectInputType('https://www.linkedin.com/in/alice-smith');
      expect(result.type).toBe('linkedin_url');
    });

    it('detects LinkedIn URL with extra query params', () => {
      const result = detectInputType('https://linkedin.com/in/bobjones?trk=some-tracking');
      expect(result.type).toBe('linkedin_url');
      expect(result.url).toBe('https://linkedin.com/in/bobjones');
    });

    it('detects email only', () => {
      const result = detectInputType('alice@example.com');
      expect(result.type).toBe('email');
      expect(result.email).toBe('alice@example.com');
    });

    it('lowercases email', () => {
      const result = detectInputType('Alice@Example.COM');
      expect(result.email).toBe('alice@example.com');
    });

    it('detects name + email', () => {
      const result = detectInputType('Bob Jones bob@example.com');
      expect(result.type).toBe('name_email');
      expect(result.name).toBe('Bob Jones');
      expect(result.email).toBe('bob@example.com');
    });

    it('detects name + email with comma', () => {
      const result = detectInputType('Bob Jones, bob@example.com');
      expect(result.type).toBe('name_email');
      expect(result.name).toBe('Bob Jones');
    });

    it('detects name + email with angle brackets', () => {
      const result = detectInputType('Bob Jones <bob@example.com>');
      expect(result.type).toBe('name_email');
      expect(result.name).toBe('Bob Jones');
    });

    it('detects resume text (multi-line, long)', () => {
      const resume = 'Bob Jones\nbob@example.com\n+1-555-0123\nSenior Engineer at Acme Corp\nExperience: 5 years';
      const result = detectInputType(resume);
      expect(result.type).toBe('resume_text');
      expect(result.text).toBe(resume);
    });

    it('detects name only', () => {
      const result = detectInputType('Alice Smith');
      expect(result.type).toBe('name_only');
      expect(result.name).toBe('Alice Smith');
    });

    it('returns unknown for empty-ish input', () => {
      const result = detectInputType('x');
      expect(result.type).toBe('unknown');
    });

    it('trims whitespace', () => {
      const result = detectInputType('  alice@example.com  ');
      expect(result.type).toBe('email');
    });
  });

  describe('parseLinkedInUrl', () => {
    it('extracts slug and guesses name', () => {
      const result = parseLinkedInUrl('https://linkedin.com/in/bob-jones');
      expect(result.linkedin_url).toBe('https://linkedin.com/in/bob-jones');
      expect(result.name_guess).toBe('Bob Jones');
    });

    it('strips hash suffix from slug', () => {
      const result = parseLinkedInUrl('https://linkedin.com/in/bob-jones-a1b2c3d4');
      expect(result.name_guess).toBe('Bob Jones');
    });

    it('handles single-word slug', () => {
      const result = parseLinkedInUrl('https://linkedin.com/in/alice');
      expect(result.name_guess).toBe('Alice');
    });

    it('returns null name_guess for invalid URL', () => {
      const result = parseLinkedInUrl('not-a-url');
      expect(result.name_guess).toBeNull();
    });
  });

  describe('parseResumeText', () => {
    it('extracts name, email, phone from resume text', () => {
      const text = 'Bob Jones\nbob@example.com\n+1-555-123-4567\nSenior Engineer at Acme Corp';
      const result = parseResumeText(text);
      expect(result.name).toBe('Bob Jones');
      expect(result.email).toBe('bob@example.com');
      expect(result.phone).toMatch(/555/);
      expect(result.company).toBe('Acme Corp');
    });

    it('handles resume without email', () => {
      const text = 'Bob Jones\n+1-555-123-4567\nSenior Engineer at Acme Corp';
      const result = parseResumeText(text);
      expect(result.name).toBe('Bob Jones');
      expect(result.email).toBeNull();
    });

    it('handles resume without title/company pattern', () => {
      const text = 'Bob Jones\nbob@example.com\nSome other text';
      const result = parseResumeText(text);
      expect(result.title).toBeNull();
      expect(result.company).toBeNull();
    });

    it('stores raw text', () => {
      const text = 'Some\nresume\ntext';
      const result = parseResumeText(text);
      expect(result.raw_text).toBe(text);
    });
  });
});
