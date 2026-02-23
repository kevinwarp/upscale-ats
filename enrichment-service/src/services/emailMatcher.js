const db = require('../db');
const logger = require('../utils/logger');

/**
 * Match a parsed email to a candidate in the database.
 *
 * Strategy:
 *   1. Match by email address (from/to depending on direction)
 *   2. Fallback: parse candidate name from subject line
 *
 * @param {object} parsed - Parsed email from gmailService.parseMessage()
 * @returns {Promise<{candidateId: number, method: string}|null>}
 */
async function matchToCandidate(parsed) {
  // 1. Match by email address
  const emailMatch = await matchByEmail(parsed);
  if (emailMatch) return emailMatch;

  // 2. Fallback: subject line parsing
  const subjectMatch = await matchBySubject(parsed.subject);
  if (subjectMatch) return subjectMatch;

  return null;
}

/**
 * Match by email address.
 * For inbound: match the sender (from).
 * For outbound: match the recipient (to).
 */
async function matchByEmail(parsed) {
  const emails = parsed.direction === 'inbound'
    ? [parsed.from]
    : parsed.to;

  for (const email of emails) {
    if (!email) continue;

    const [rows] = await db.query(
      'SELECT candidate_id FROM candidate WHERE email1 = ? OR personal_email = ? LIMIT 1',
      [email, email]
    );

    if (rows.length > 0) {
      logger.debug('Email matched by address', { email, candidateId: rows[0].candidate_id });
      return { candidateId: rows[0].candidate_id, method: 'email' };
    }
  }

  return null;
}

/**
 * Fallback: try to extract a candidate name from the email subject
 * and match against the candidate table.
 *
 * Looks for patterns like:
 *   "Re: Interview with John Smith"
 *   "Homework: Jane Doe - Senior Engineer"
 *   "Phone Screen - Alex Johnson"
 */
async function matchBySubject(subject) {
  if (!subject) return null;

  // Strip common prefixes
  const cleaned = subject
    .replace(/^(Re|Fwd|FW|RE|Fw):\s*/gi, '')
    .trim();

  // Try extracting name after common patterns
  const patterns = [
    /(?:interview|call|screen|homework|assignment)\s+(?:with|for|[-–—])\s+([A-Z][a-z]+ [A-Z][a-z]+)/i,
    /^([A-Z][a-z]+ [A-Z][a-z]+)\s*[-–—]/,
    /[-–—]\s*([A-Z][a-z]+ [A-Z][a-z]+)\s*$/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      const parts = name.split(/\s+/);

      if (parts.length >= 2) {
        const [rows] = await db.query(
          'SELECT candidate_id FROM candidate WHERE first_name = ? AND last_name = ? LIMIT 1',
          [parts[0], parts.slice(1).join(' ')]
        );

        if (rows.length > 0) {
          logger.debug('Email matched by subject name', { name, candidateId: rows[0].candidate_id });
          return { candidateId: rows[0].candidate_id, method: 'subject_parse' };
        }
      }
    }
  }

  return null;
}

module.exports = { matchToCandidate, matchByEmail, matchBySubject };
