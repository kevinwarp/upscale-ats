const express = require('express');
const db = require('../db');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /v1/analytics/pipeline
 * Time-in-stage metrics, conversion rates, throughput.
 */
router.get('/pipeline', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    // Stage distribution
    const [stageDistribution] = await db.query(`
      SELECT candidate_stage AS stage,
             COUNT(*) AS count,
             AVG(DATEDIFF(NOW(), stage_changed_at)) AS avg_days_in_stage
      FROM candidate
      WHERE candidate_stage IS NOT NULL
      GROUP BY candidate_stage
    `);

    // Conversion rates (transitions in period)
    const [transitions] = await db.query(`
      SELECT from_stage, to_stage, COUNT(*) AS count
      FROM candidate_stage_history
      WHERE changed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY from_stage, to_stage
      ORDER BY count DESC
    `, [parseInt(days)]);

    // Throughput (candidates entering pipeline per week)
    const [throughput] = await db.query(`
      SELECT YEARWEEK(changed_at) AS week,
             COUNT(*) AS candidates_entered
      FROM candidate_stage_history
      WHERE to_stage = 'in_pipeline'
        AND changed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY YEARWEEK(changed_at)
      ORDER BY week DESC
    `, [parseInt(days)]);

    // Time to hire (candidates who reached offer)
    const [timeToHire] = await db.query(`
      SELECT AVG(DATEDIFF(
        (SELECT MAX(changed_at) FROM candidate_stage_history WHERE candidate_id = csh.candidate_id AND to_stage = 'offer'),
        (SELECT MIN(changed_at) FROM candidate_stage_history WHERE candidate_id = csh.candidate_id AND to_stage = 'in_pipeline')
      )) AS avg_days_to_offer
      FROM candidate_stage_history csh
      WHERE to_stage = 'offer'
        AND changed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [parseInt(days)]);

    res.json({
      period_days: parseInt(days),
      stage_distribution: stageDistribution,
      transitions,
      weekly_throughput: throughput,
      avg_days_to_offer: timeToHire[0]?.avg_days_to_offer || null,
    });
  } catch (err) {
    logger.error('Pipeline analytics failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get pipeline analytics' });
  }
});

/**
 * GET /v1/analytics/feedback
 * Completion rates, avg scores by role, interviewer stats.
 */
router.get('/feedback', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    // Overall completion rate
    const [completion] = await db.query(`
      SELECT
        COUNT(*) AS total_requested,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS total_submitted,
        SUM(CASE WHEN status = 'locked' THEN 1 ELSE 0 END) AS total_expired,
        ROUND(SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) / COUNT(*) * 100, 1) AS completion_rate
      FROM interview_feedback
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [parseInt(days)]);

    // Average scores by job
    const [scoresByJob] = await db.query(`
      SELECT job_title,
             COUNT(*) AS feedback_count,
             ROUND(AVG((score_technical + score_communication + score_culture_fit + score_problem_solving) / 4.0), 2) AS avg_score
      FROM interview_feedback
      WHERE status = 'submitted'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY job_title
      ORDER BY avg_score DESC
    `, [parseInt(days)]);

    // Interviewer stats (response time, avg scores)
    const [interviewerStats] = await db.query(`
      SELECT interviewer_name,
             COUNT(*) AS feedback_count,
             ROUND(AVG(TIMESTAMPDIFF(HOUR, created_at, submitted_at)), 1) AS avg_response_hours,
             ROUND(AVG((score_technical + score_communication + score_culture_fit + score_problem_solving) / 4.0), 2) AS avg_score
      FROM interview_feedback
      WHERE status = 'submitted'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY interviewer_name
      ORDER BY feedback_count DESC
    `, [parseInt(days)]);

    res.json({
      period_days: parseInt(days),
      completion: completion[0] || {},
      scores_by_job: scoresByJob,
      interviewer_stats: interviewerStats,
    });
  } catch (err) {
    logger.error('Feedback analytics failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get feedback analytics' });
  }
});

/**
 * GET /v1/analytics/email
 * Ingestion volume, match rate, outreach response rate.
 */
router.get('/email', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const [stats] = await db.query(`
      SELECT
        COUNT(*) AS total_ingested,
        SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS matched,
        SUM(CASE WHEN status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound,
        SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound,
        ROUND(SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 1) AS match_rate
      FROM email_ingestion_logs
      WHERE processed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [parseInt(days)]);

    // Daily volume
    const [dailyVolume] = await db.query(`
      SELECT DATE(processed_at) AS date,
             COUNT(*) AS count,
             SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS matched
      FROM email_ingestion_logs
      WHERE processed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(processed_at)
      ORDER BY date DESC
    `, [parseInt(days)]);

    res.json({
      period_days: parseInt(days),
      summary: stats[0] || {},
      daily_volume: dailyVolume,
    });
  } catch (err) {
    logger.error('Email analytics failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get email analytics' });
  }
});

module.exports = router;
