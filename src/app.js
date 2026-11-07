const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { loadConfig } = require('./config');
const { MemoryOtpStore } = require('./modules/otp/store');
const { OtpService } = require('./modules/otp/service');
const { ResilientStore } = require('./modules/otp/resilientStore');
const { EmailService } = require('./modules/email/service');
const { QueuedEmailService } = require('./modules/email/queue');
const { TemplateService } = require('./modules/template/service');
const { SmtpCredentialsService } = require('./modules/smtp/credentials');
const { AuthService } = require('./modules/auth/service');
const { getOrCreateKey } = require('./lib/crypto');
const { FileKV, RedisKV } = require('./lib/kv');
const { otpRoutes } = require('./modules/otp/routes');
const { templateRoutes } = require('./modules/template/routes');
const { smtpRoutes } = require('./modules/smtp/routes');
const { authRoutes } = require('./modules/auth/routes');
const { requireAuthApi, requireAuthPage } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');

function buildStore(config) {
  if (config.store === 'redis') {
    if (config.upstashToken) {
      const { UpstashOtpStore } = require('./modules/otp/upstashStore');
      return new UpstashOtpStore({ url: config.upstashUrl, token: config.upstashToken });
    }
    const { RedisOtpStore } = require('./modules/otp/redisStore');
    return new RedisOtpStore({ url: config.redisUrl });
  }
  return new MemoryOtpStore();
}

function buildKv(config) {
  if (config.kvBackend === 'redis') {
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({ url: config.upstashUrl, token: config.upstashToken });
    return new RedisKV(redis);
  }
  return new FileKV(config.kvDir);
}

function createApp(overrides = {}) {
  const config = loadConfig(overrides.env || process.env);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  const secretKey = getOrCreateKey(config.masterKey, config.secretKeyFile);
  const kv = buildKv(config);
  const templateService = new TemplateService({ kv, key: 'message-template' });
  const smtpCredentials = new SmtpCredentialsService({
    kv,
    key: 'smtp-credentials',
    envFilePath: config.envFilePath,
    secretKey,
    fallbackUser: config.emailUser,
    fallbackPass: config.emailPass,
    syncEnv: config.kvBackend === 'file',
  });
  const authService = new AuthService({
    kv,
    key: 'admin',
    defaultEmail: config.adminDefaultEmail,
    defaultPass: config.adminDefaultPass,
    sessionTtlMs: config.sessionTtlMs,
    secretKey,
  });

  const otpStore = new ResilientStore(buildStore(config));
  const emailService = new EmailService(config, templateService, smtpCredentials);

  const emailDeliverer =
    config.emailQueueConcurrency > 1
      ? new QueuedEmailService(emailService, { concurrency: config.emailQueueConcurrency })
      : emailService;

  const otpService = new OtpService({ store: otpStore, emailService: emailDeliverer, config });

  app.locals.config = config;
  app.locals.otpService = otpService;
  app.locals.otpStore = otpStore;
  app.locals.templateService = templateService;
  app.locals.smtpCredentials = smtpCredentials;
  app.locals.authService = authService;

  // Expired-record purge is only needed for the in-memory store.
  if (typeof otpStore.purgeExpired === 'function') {
    const purgeInterval = Math.max(5000, Math.min(config.otpTtlMs, 60000));
    const purgeTimer = setInterval(() => otpStore.purgeExpired(), purgeInterval);
    if (purgeTimer.unref) purgeTimer.unref();
    app.locals.purgeTimer = purgeTimer;
  }

  app.get('/health', (req, res) => res.json({ status: 'ok', store: otpStore.status() }));
  app.use('/api/auth', authRoutes());

  // Public OTP API
  app.use('/api/otp', otpRoutes(config));

  // Settings support APIs — require admin login
  app.use('/api/template', requireAuthApi, templateRoutes());
  app.use('/api/smtp', requireAuthApi, smtpRoutes());

  // Pages
  app.use('/login', express.static(path.join(__dirname, '..', 'public', 'login.html')));
  app.use('/settings', requireAuthPage, express.static(path.join(__dirname, '..', 'public', 'settings.html')));
  app.use('/docs', express.static(path.join(__dirname, '..', 'public', 'docs.html')));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
