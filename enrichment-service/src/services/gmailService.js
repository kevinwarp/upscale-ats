const { google } = require('googleapis');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const googleAuth = require('./googleAuth');
const workflowEngine = require('./workflowEngine');
const slackService = require('./slackService');

// Lazy-load emailMatcher to avoid circular deps
let emailMatcher = null;
function getEmailMatcher() {
  if (!emailMatcher) emailMatcher = require('./emailMatcher');
  return emailMatcher;
}

// ============================================================================
// Gmail Watch — subscribe to inbox push notifications
// ============================================================================

/**
 * Set up Gmail watch for a user via Google Pub/Sub.
 * Must be renewed every 7 days (handled by calendarSyncJob or a dedicated cron).
 */
async function setupWatch(userId) {
  const auth = await googleAuth.getAuthenticatedClient(userId);
  if (!auth) {
    logger.warn('Cannot setup Gmail watch: user not authenticated', { userId });
    return null;
  }

  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: config.google.gmailPubsubTopic,
        labelIds: config.google.gmailWatchLabelIds,
      },
    });

    logger.info('Gmail watch registered', { userId, historyId: response.data.historyId });
    return response.data;
  } catch (err) {
    logger.error('Gmail watch setup failed', { userId, error: err.message });
    throw err;
  }
}

// ============================================================================
// Message fetching and parsing
// ============================================================================

/**
 * Fetch a Gmail message by ID and parse it into a structured format.
 */
async function fetchAndParseMessage(userId, messageId) {
  const auth = await googleAuth.getAuthenticatedClient(userId);
  if (!auth) return null;

  const gmail = google.gmail({ version: 'v1', auth });

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  return parseMessage(response.data);
}

/**
 * Fetch recent messages since a history ID.
 */
async function fetchHistorySince(userId, startHistoryId) {
  const auth = await googleAuth.getAuthenticatedClient(userId);
  if (!auth) return [];

  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      labelId: 'INBOX',
      historyTypes: ['messageAdded'],
    });

    const messageIds = [];
    for (const record of response.data.history || []) {
      for (const msg of record.messagesAdded || []) {
        messageIds.push(msg.message.id);
      }
    }

    return messageIds;
  } catch (err) {
    if (err.code === 404) {
      // historyId expired — need full sync
      logger.warn('Gmail history expired, full sync needed', { userId });
      return [];
    }
    throw err;
  }
}

/**
 * Parse a raw Gmail message into structured format.
 */
function parseMessage(message) {
  const headers = message.payload?.headers || [];
  const getHeader = (name) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const from = getHeader('From');
  const to = getHeader('To');
  const cc = getHeader('Cc');
  const subject = getHeader('Subject');
  const date = getHeader('Date');

  // Extract email addresses
  const fromAddr = extractEmailAddress(from);
  const toAddrs = extractEmailAddresses(to);
  const ccAddrs = extractEmailAddresses(cc);

  // Determine direction
  const jobsAddr = config.google.gmailJobsAddress.toLowerCase();
  const isOutbound = fromAddr.toLowerCase() === jobsAddr ||
    toAddrs.some((a) => a.toLowerCase() !== jobsAddr) && ccAddrs.some((a) => a.toLowerCase() === jobsAddr);

  // Extract attachments
  const attachments = extractAttachments(message.payload);

  return {
    messageId: message.id,
    threadId: message.threadId,
    from: fromAddr,
    to: toAddrs,
    cc: ccAddrs,
    subject,
    date,
    direction: isOutbound ? 'outbound' : 'inbound',
    attachments,
    hasAttachments: attachments.length > 0,
    snippet: message.snippet || '',
  };
}

/**
 * Extract a single email address from a "Name <email>" string.
 */
function extractEmailAddress(str) {
  if (!str) return '';
  const match = str.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : str.trim().toLowerCase();
}

/**
 * Extract multiple email addresses from a comma-separated header.
 */
function extractEmailAddresses(str) {
  if (!str) return [];
  return str.split(',').map((s) => extractEmailAddress(s.trim())).filter(Boolean);
}

/**
 * Extract attachment metadata from a MIME payload.
 */
function extractAttachments(payload, results = []) {
  if (!payload) return results;

  if (payload.filename && payload.body?.attachmentId) {
    results.push({
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.body.size || 0,
      attachmentId: payload.body.attachmentId,
    });
  }

  for (const part of payload.parts || []) {
    extractAttachments(part, results);
  }

  return results;
}

// ============================================================================
// Email processing pipeline
// ============================================================================

/**
 * Process a single parsed email message through the workflow rules.
 * Called by the webhook handler after fetching + parsing.
 */
async function processEmail(parsed) {
  const matcher = getEmailMatcher();

  // Check for duplicate
  const [existing] = await db.query(
    'SELECT id FROM email_ingestion_logs WHERE gmail_message_id = ?',
    [parsed.messageId]
  );
  if (existing.length > 0) {
    logger.debug('Email already processed, skipping', { messageId: parsed.messageId });
    return { status: 'duplicate' };
  }

  // Match to candidate
  const match = await matcher.matchToCandidate(parsed);

  // Log ingestion
  const [insertResult] = await db.query(
    `INSERT INTO email_ingestion_logs
      (gmail_message_id, thread_id, from_addr, to_addrs, cc_addrs, subject,
       direction, matched_candidate_id, match_method, attachments, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsed.messageId,
      parsed.threadId,
      parsed.from,
      parsed.to.join(', '),
      parsed.cc.join(', '),
      parsed.subject,
      parsed.direction,
      match?.candidateId || null,
      match?.method || null,
      JSON.stringify(parsed.attachments),
      match ? 'processed' : 'unmatched',
    ]
  );

  if (!match) {
    logger.info('Email unmatched', { messageId: parsed.messageId, subject: parsed.subject });
    return { status: 'unmatched', messageId: parsed.messageId };
  }

  // Apply workflow rules
  const actions = [];

  // Step 4: Outreach detection (outbound + jobs@ in CC)
  if (parsed.direction === 'outbound' && isJobsAddressInCC(parsed)) {
    await db.query('UPDATE candidate SET outreach_sent = TRUE WHERE candidate_id = ?', [match.candidateId]);
    await workflowEngine.logEvent({
      candidateId: match.candidateId,
      eventType: 'outreach_detected',
      eventData: { subject: parsed.subject, messageId: parsed.messageId },
      source: 'gmail',
    });

    // Get candidate name for Slack
    const [cand] = await db.query(
      "SELECT CONCAT(first_name, ' ', last_name) AS name FROM candidate WHERE candidate_id = ?",
      [match.candidateId]
    );
    const name = cand[0]?.name || 'Unknown';
    slackService.notifyOutreachLogged(name, match.candidateId).catch(() => {});
    actions.push('outreach_detected');
  }

  // Step 9: Homework sent detection (outbound + "homework" in subject)
  if (parsed.direction === 'outbound' && isHomeworkEmail(parsed.subject)) {
    try {
      await workflowEngine.transitionStage({
        candidateId: match.candidateId,
        toStage: 'homework_assignment',
        trigger: 'gmail',
        reason: 'Homework assignment email detected',
        metadata: { messageId: parsed.messageId },
      });
      actions.push('homework_sent');
    } catch (err) {
      logger.warn('Homework stage transition failed', { error: err.message, candidateId: match.candidateId });
    }
  }

  // Step 10: Homework submission detection (inbound + attachment)
  if (parsed.direction === 'inbound' && parsed.hasAttachments) {
    await db.query('UPDATE candidate SET homework_received = TRUE WHERE candidate_id = ?', [match.candidateId]);
    await workflowEngine.logEvent({
      candidateId: match.candidateId,
      eventType: 'homework_received',
      eventData: {
        attachments: parsed.attachments.map((a) => a.filename),
        messageId: parsed.messageId,
      },
      source: 'gmail',
    });

    const [cand] = await db.query(
      "SELECT CONCAT(first_name, ' ', last_name) AS name FROM candidate WHERE candidate_id = ?",
      [match.candidateId]
    );
    const name = cand[0]?.name || 'Unknown';
    slackService.notifyHomeworkReceived(name, match.candidateId).catch(() => {});
    actions.push('homework_received');
  }

  logger.info('Email processed', {
    messageId: parsed.messageId,
    candidateId: match.candidateId,
    actions,
  });

  return {
    status: 'processed',
    candidateId: match.candidateId,
    matchMethod: match.method,
    actions,
  };
}

// ============================================================================
// Detection helpers
// ============================================================================

function isJobsAddressInCC(parsed) {
  const jobsAddr = config.google.gmailJobsAddress.toLowerCase();
  if (!jobsAddr) return false;
  return parsed.cc.some((addr) => addr.toLowerCase() === jobsAddr);
}

function isHomeworkEmail(subject) {
  if (!subject) return false;
  return /homework/i.test(subject);
}

module.exports = {
  setupWatch,
  fetchAndParseMessage,
  fetchHistorySince,
  parseMessage,
  extractEmailAddress,
  extractEmailAddresses,
  extractAttachments,
  processEmail,
  isJobsAddressInCC,
  isHomeworkEmail,
};
