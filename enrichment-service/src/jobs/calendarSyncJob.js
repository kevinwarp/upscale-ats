const calendarWatcher = require('../services/calendarWatcher');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start the calendar sync polling job.
 * Runs every 5 minutes as a fallback for environments
 * where push notifications aren't available.
 */
function start() {
  logger.info('Calendar sync job started (polling every 5 min)');
  setInterval(run, POLL_INTERVAL_MS);
  // Initial run after 30s to let the service stabilize
  setTimeout(run, 30000);
}

async function run() {
  try {
    await calendarWatcher.pollRecentEvents();
  } catch (err) {
    logger.error('Calendar sync job error', { error: err.message });
  }
}

module.exports = { start, run };
