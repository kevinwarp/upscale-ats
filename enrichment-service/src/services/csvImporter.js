const { parse } = require('csv-parse/sync');
const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');

const MAX_ROWS = 500;

/**
 * Start a CSV import job. Parses the CSV, creates the job record,
 * and processes rows asynchronously.
 */
async function startImport(buffer, filename, userId, jobId, defaultSource) {
  const csvString = buffer.toString('utf-8');

  let records;
  try {
    records = parse(csvString, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    throw new Error(`CSV parse error: ${err.message}`);
  }

  if (records.length === 0) {
    throw new Error('CSV file is empty');
  }

  if (records.length > MAX_ROWS) {
    throw new Error(`CSV exceeds maximum of ${MAX_ROWS} rows (got ${records.length})`);
  }

  // Validate: must have first_name or email column
  const cols = Object.keys(records[0]).map((c) => c.toLowerCase());
  if (!cols.includes('first_name') && !cols.includes('email')) {
    throw new Error('CSV must contain at least a first_name or email column');
  }

  const importId = crypto.randomUUID();

  // Create job record
  await db.query(
    `INSERT INTO import_jobs (id, user_id, filename, total_rows, status)
     VALUES (?, ?, ?, ?, 'processing')`,
    [importId, userId, filename, records.length]
  );

  // Process asynchronously (non-blocking)
  setTimeout(() => processRows(importId, records, jobId, defaultSource), 0);

  return { id: importId, total_rows: records.length };
}

/**
 * Process CSV rows one by one.
 */
async function processRows(importId, records, jobId, defaultSource) {
  const results = [];
  let created = 0;
  let duplicates = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i++) {
    const row = normalizeRow(records[i]);
    const rowNum = i + 1;

    try {
      // Validate minimum fields
      if (!row.first_name && !row.email) {
        results.push({ row: rowNum, status: 'error', error: 'Missing first_name and email' });
        errors++;
        continue;
      }

      // Duplicate check by email
      if (row.email) {
        const [existing] = await db.query(
          'SELECT candidate_id FROM candidate WHERE email1 = ? LIMIT 1',
          [row.email]
        );
        if (existing.length > 0) {
          results.push({
            row: rowNum, status: 'duplicate',
            existing_candidate_id: existing[0].candidate_id,
            matched_on: 'email',
          });
          duplicates++;
          continue;
        }
      }

      // Duplicate check by LinkedIn URL
      if (row.linkedin_url) {
        const [existing] = await db.query(
          'SELECT candidate_id FROM candidate WHERE web_site = ? LIMIT 1',
          [row.linkedin_url]
        );
        if (existing.length > 0) {
          results.push({
            row: rowNum, status: 'duplicate',
            existing_candidate_id: existing[0].candidate_id,
            matched_on: 'linkedin_url',
          });
          duplicates++;
          continue;
        }
      }

      // Insert
      const [insertResult] = await db.query(
        `INSERT INTO candidate
          (first_name, last_name, email1, phone_home, web_site,
           candidate_stage, stage_changed_at, source, enrichment_status, date_created, site_id)
         VALUES (?, ?, ?, ?, ?, 'applied', NOW(), ?, 'pending', NOW(), 1)`,
        [
          row.first_name || '',
          row.last_name || '',
          row.email || null,
          row.phone || null,
          row.linkedin_url || null,
          row.source || defaultSource,
        ]
      );

      results.push({
        row: rowNum, status: 'created',
        candidate_id: insertResult.insertId,
        name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      });
      created++;
    } catch (err) {
      logger.error('Import row error', { importId, row: rowNum, error: err.message });
      results.push({ row: rowNum, status: 'error', error: err.message });
      errors++;
    }

    // Update progress periodically
    if (rowNum % 10 === 0 || rowNum === records.length) {
      await db.query(
        `UPDATE import_jobs SET rows_processed = ?, rows_created = ?, rows_duplicate = ?, rows_error = ?
         WHERE id = ?`,
        [rowNum, created, duplicates, errors, importId]
      );
    }
  }

  // Finalize
  await db.query(
    `UPDATE import_jobs
     SET status = 'completed', completed_at = NOW(),
         rows_processed = ?, rows_created = ?, rows_duplicate = ?, rows_error = ?,
         result_data = ?
     WHERE id = ?`,
    [records.length, created, duplicates, errors, JSON.stringify(results), importId]
  );

  logger.info('Import completed', { importId, created, duplicates, errors });
}

/**
 * Normalize a CSV row's keys to lowercase.
 */
function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key.toLowerCase().trim()] = value?.trim() || null;
  }
  return normalized;
}

/**
 * Get import job status.
 */
async function getImportStatus(importId) {
  const [rows] = await db.query('SELECT * FROM import_jobs WHERE id = ?', [importId]);
  if (rows.length === 0) return null;

  const job = rows[0];
  const resultData = job.result_data ? (typeof job.result_data === 'string' ? JSON.parse(job.result_data) : job.result_data) : [];

  return {
    import_job_id: job.id,
    status: job.status,
    total_rows: job.total_rows,
    created: job.rows_created,
    duplicates: job.rows_duplicate,
    errors: job.rows_error,
    rows_processed: job.rows_processed,
    result_csv_url: `/v1/candidates/import/${job.id}/results.csv`,
    rows: resultData,
  };
}

/**
 * Generate results CSV string for download.
 */
async function getResultsCsv(importId) {
  const status = await getImportStatus(importId);
  if (!status) return null;

  const header = 'row,status,candidate_id,matched_on,error\n';
  const rows = (status.rows || []).map((r) =>
    `${r.row},${r.status},${r.candidate_id || ''},${r.matched_on || ''},${(r.error || '').replace(/,/g, ';')}`
  ).join('\n');

  return header + rows;
}

module.exports = { startImport, getImportStatus, getResultsCsv };
