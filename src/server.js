const { createApp } = require('./app');
const logger = require('./lib/logger');

// Never let an async error take the process down silently.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', err);
});

const app = createApp();
const config = app.locals.config;

const server = app.listen(config.port, () => {
  logger.info(`STW-Verify listening at ${config.baseUrl} (port ${config.port})`);
  logger.warn(`Email transport: ${config.emailTransport}`);
  logger.info(`OTP store: ${config.store}`);
  if (config.emailTransport === 'console') {
    logger.warn('Console transport active: OTPs are logged to the server console, not delivered.');
  }
});

module.exports = server;
