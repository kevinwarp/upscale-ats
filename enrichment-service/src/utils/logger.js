const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ats-enrichment-service' },
  transports: [
    new winston.transports.Console({
      format:
        config.nodeEnv === 'development'
          ? winston.format.combine(winston.format.colorize(), winston.format.simple())
          : winston.format.json(),
    }),
  ],
});

module.exports = logger;
