/**
 * STW-Verify — startup entry.
 *
 * Run with:  node server.js
 * Or as a pm2/systemd startup file pointing at this file.
 */
const { createApp } = require('./src/app');
const logger = require('./src/lib/logger');

// Never let an async error take the process down silently.
process.on('unhandledRejection', (reason) => {
  logger.error('[process] unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('[process] uncaughtException', err);
});

const app = createApp();
const config = app.locals.config;

const server = app.listen(config.port, () => {
  logger.info(`STW-Verify listening at ${config.baseUrl} (port ${config.port})`);
  logger.warn(`Email transport: ${config.emailTransport}`);
  logger.info(`OTP store: ${config.store}`);
  logger.info(`Settings backend: ${config.kvBackend}`);
  if (config.emailTransport === 'console') {
    logger.warn('Console transport active: OTPs are logged to the server console, not delivered.');
  }
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[process] ${signal} received — shutting down`);
  server.close(() => {
    logger.info('[process] server closed, exiting');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
