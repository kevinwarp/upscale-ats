const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const feedbackService = require('../services/feedbackService');
const slackService = require('../services/slackService');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Start the post-interview check job.
 * Checks for recently ended interviews and triggers feedback requests.
 */
function start() {
  logger.info('Post-interview check job started');
  setInterval(run, CHECK_INTERVAL_MS);
  setTimeout(run, 10000);
}

async function run() {
  try {
    const [events] = await db.query(`
      SELECT ie.*, GROUP_CONCAT(iep.user_id) AS participant_ids
      FROM interview_events ie
      LEFT JOIN interview_event_participants iep ON ie.id = iep.event_id
      WHERE ie.status = 'scheduled'
        AND ie.end_time < NOW()
        AND ie.end_time > DATE_SUB(NOW(), INTERVAL 2 HOUR)
        AND ie.feedback_requested = FALSE
      GROUP BY ie.id
    `);

    if (events.length === 0) return;

    logger.info(`Processing ${events.length} completed interviews`);

    for (const event of events) {
      try {
        // Get candidate name
        const [candidates] = await db.query(
          "SELECT CONCAT(first_name, ' ', last_name) AS name FROM candidate WHERE candidate_id = ?",
          [event.candidate_id]
        );
        const candidateName = candidates[0]?.name || 'Unknown';

        // Create feedback requests for each participant
        const participantIds = event.participant_ids
          ? event.participant_ids.split(',').map((id) => parseInt(id))
          : [];

        for (const userId of participantIds) {
          // Get interviewer info
          const [users] = await db.query(
            "SELECT CONCAT(first_name, ' ', last_name) AS name, email FROM user WHERE user_id = ?",
            [userId]
          ).catch(() => [[]]);

          const userName = users[0]?.name || `User ${userId}`;
          const userEmail = users[0]?.email || null;

          const fbRequest = await feedbackService.createFeedbackRequest({
            candidate_id: event.candidate_id,
            job_id: event.job_id,
            interviewer_user_id: userId,
            interviewer_email: userEmail,
            interviewer_name: userName,
            candidate_name: candidateName,
            job_title: event.title,
            event_id: event.google_event_id,
          });

          // Send Slack DM with feedback link
          if (userEmail) {
            const slackUserId = await slackService.lookupUserByEmail(userEmail);
            if (slackUserId) {
              slackService.sendFeedbackRequestDM(slackUserId, {
                candidateName,
                jobTitle: event.title,
                feedbackUrl: fbRequest.form_url,
                candidateId: event.candidate_id,
                jobId: event.job_id,
              }).catch((err) => logger.error('Feedback DM failed', { error: err.message }));
            }
          }
        }

        // Mark event as completed with feedback requested
        await db.query(
          "UPDATE interview_events SET status = 'completed', feedback_requested = TRUE WHERE id = ?",
          [event.id]
        );

        logger.info('Post-interview feedback triggered', {
          eventId: event.id,
          candidateId: event.candidate_id,
          interviewers: participantIds.length,
        });
      } catch (err) {
        logger.error('Failed to process completed interview', {
          eventId: event.id,
          error: err.message,
        });
      }
    }
  } catch (err) {
    logger.error('Post-interview check job error', { error: err.message });
  }
}

module.exports = { start, run };
