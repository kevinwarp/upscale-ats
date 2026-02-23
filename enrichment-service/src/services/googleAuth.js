const { google } = require('googleapis');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Create an OAuth2 client with app credentials.
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Generate the Google OAuth consent URL.
 */
function getAuthUrl(userId) {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    state: JSON.stringify({ user_id: userId }),
  });
}

/**
 * Exchange authorization code for tokens and store them.
 */
async function handleCallback(code, state) {
  const { user_id } = JSON.parse(state);
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  await db.query(
    `INSERT INTO user_integrations
      (user_id, provider, access_token, refresh_token, token_expires_at, scopes, is_active)
     VALUES (?, 'google_calendar', ?, ?, ?, 'calendar.readonly,calendar.events', TRUE)
     ON DUPLICATE KEY UPDATE
       access_token = ?, refresh_token = COALESCE(?, refresh_token),
       token_expires_at = ?, is_active = TRUE`,
    [
      user_id, tokens.access_token, tokens.refresh_token,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      tokens.access_token, tokens.refresh_token,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    ]
  );

  logger.info('Google Calendar connected', { userId: user_id });
  return { user_id, connected: true };
}

/**
 * Get an authenticated OAuth2 client for a user.
 * Auto-refreshes expired tokens.
 */
async function getAuthenticatedClient(userId) {
  const [rows] = await db.query(
    `SELECT access_token, refresh_token, token_expires_at
     FROM user_integrations
     WHERE user_id = ? AND provider = 'google_calendar' AND is_active = TRUE`,
    [userId]
  );

  if (rows.length === 0) return null;

  const { access_token, refresh_token, token_expires_at } = rows[0];
  const client = createOAuth2Client();

  client.setCredentials({
    access_token,
    refresh_token,
    expiry_date: token_expires_at ? new Date(token_expires_at).getTime() : undefined,
  });

  // Check if token needs refresh
  const isExpired = token_expires_at && new Date(token_expires_at) < new Date();
  if (isExpired && refresh_token) {
    try {
      const { credentials } = await client.refreshAccessToken();
      await db.query(
        `UPDATE user_integrations SET access_token = ?, token_expires_at = ?
         WHERE user_id = ? AND provider = 'google_calendar'`,
        [credentials.access_token, new Date(credentials.expiry_date), userId]
      );
      client.setCredentials(credentials);
      logger.info('Google token refreshed', { userId });
    } catch (err) {
      logger.error('Google token refresh failed', { userId, error: err.message });
      await db.query(
        `UPDATE user_integrations SET is_active = FALSE WHERE user_id = ? AND provider = 'google_calendar'`,
        [userId]
      );
      return null;
    }
  }

  return client;
}

/**
 * Disconnect a user's Google Calendar integration.
 */
async function disconnect(userId) {
  const client = await getAuthenticatedClient(userId);
  if (client) {
    try {
      await client.revokeCredentials();
    } catch (err) {
      logger.warn('Token revocation failed (continuing with disconnect)', { error: err.message });
    }
  }

  await db.query(
    `DELETE FROM user_integrations WHERE user_id = ? AND provider = 'google_calendar'`,
    [userId]
  );

  logger.info('Google Calendar disconnected', { userId });
}

/**
 * Get connection status for a user.
 */
async function getConnectionStatus(userId) {
  const [rows] = await db.query(
    `SELECT is_active, created_at, scopes FROM user_integrations
     WHERE user_id = ? AND provider = 'google_calendar'`,
    [userId]
  );

  if (rows.length === 0) {
    return { provider: 'google_calendar', is_connected: false };
  }

  return {
    provider: 'google_calendar',
    is_connected: !!rows[0].is_active,
    connected_at: rows[0].created_at,
    scopes: rows[0].scopes?.split(',') || [],
  };
}

module.exports = {
  createOAuth2Client, getAuthUrl, handleCallback,
  getAuthenticatedClient, disconnect, getConnectionStatus,
};
