const mysql = require('mysql2/promise');
const config = require('./config');
const logger = require('./utils/logger');

let pool = null;

/**
 * Get or create the MySQL connection pool.
 * @returns {import('mysql2/promise').Pool}
 */
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.name,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });

    logger.info('MySQL connection pool created', {
      host: config.db.host,
      database: config.db.name,
    });
  }

  return pool;
}

/**
 * Execute a query with parameters.
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<[any[], any]>}
 */
async function query(sql, params = []) {
  const db = getPool();
  return db.execute(sql, params);
}

/**
 * Get a single connection for transactions.
 * @returns {Promise<import('mysql2/promise').PoolConnection>}
 */
async function getConnection() {
  const db = getPool();
  return db.getConnection();
}

/**
 * Close the pool (for graceful shutdown / tests).
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('MySQL connection pool closed');
  }
}

module.exports = { getPool, query, getConnection, close };
