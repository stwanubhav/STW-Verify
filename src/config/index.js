require('dotenv').config();
const path = require('path');

const bool = (v, d) => {
  if (v === undefined || v === '') return d;
  return v === 'true' || v === '1';
};

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 3000),
    baseUrl: env.BASE_URL || `http://localhost:${int(env.PORT, 3000)}`,
    nodeEnv: env.NODE_ENV || 'development',

    emailTransport: (env.EMAIL_TRANSPORT || 'console').toLowerCase(),
    emailHost: env.EMAIL_HOST || 'smtp.gmail.com',
    emailPort: int(env.EMAIL_PORT, 465),
    emailSecure: bool(env.EMAIL_SECURE, true),
    emailUser: env.EMAIL_USER || '',
    emailPass: env.EMAIL_PASS || '',
    emailFrom: env.EMAIL_FROM || env.EMAIL_USER || 'STW-Verify',

    otpTtlMs: int(env.OTP_TTL_MS, 300000),
    otpLength: int(env.OTP_LENGTH, 4),
    otpMin: int(env.OTP_MIN, 1000),
    otpMax: int(env.OTP_MAX, 9999),

    // OTP storage backend: "memory" (dev/test) or "redis" (production).
    // Defaults to redis when REDIS_URL is present, otherwise memory.
    store: (env.STORE || (env.REDIS_URL ? 'redis' : 'memory')).toLowerCase(),
    redisUrl: env.REDIS_URL || 'redis://127.0.0.1:6379',

    // Max incorrect verification attempts before an OTP is invalidated.
    verifyMaxAttempts: int(env.VERIFY_MAX_ATTEMPTS, 5),

    // Email message template file (editable via /settings page).
    templateFile:
      env.TEMPLATE_FILE ||
      path.join(__dirname, '..', '..', 'data', 'message-template.json'),

    // SMTP credentials override file (editable via /settings page).
    smtpCredentialsFile:
      env.SMTP_CREDENTIALS_FILE ||
      path.join(__dirname, '..', '..', 'data', 'smtp-credentials.json'),

    // .env file path used to keep SMTP credentials in sync in both directions.
    envFilePath: env.ENV_FILE || path.join(process.cwd(), '.env'),

    // Admin login for the settings panel.
    adminCredentialsFile:
      env.ADMIN_CREDENTIALS_FILE ||
      path.join(__dirname, '..', '..', 'data', 'admin-credentials.json'),
    adminDefaultEmail: env.ADMIN_EMAIL || 'admin@gmail.com',
    adminDefaultPass: env.ADMIN_PASSWORD || 'admin123',
    sessionTtlMs: int(env.SESSION_TTL_MS, 43200000),

    // Master encryption key for secrets at rest. If unset, a key file is
    // generated at data/.secret.key (gitignored). Prefer setting MASTER_KEY
    // in production.
    masterKey: env.MASTER_KEY || '',
    secretKeyFile:
      env.SECRET_KEY_FILE ||
      path.join(__dirname, '..', '..', 'data', '.secret.key'),

    // Settings persistence backend: "file" (dev/local) or "redis" (Vercel).
    kvBackend: env.KV_BACKEND || (env.REDIS_URL ? 'redis' : 'file'),
    kvDir: env.KV_DIR || path.join(__dirname, '..', '..', 'data', 'kv'),
    upstashUrl: env.UPSTASH_REDIS_REST_URL || env.REDIS_URL || 'https://example.upstash.io',
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN || '',

    // Email delivery queue: bounds simultaneous SMTP sends so a burst of
    // /send requests does not exhaust sockets or block the event loop.
    emailQueueConcurrency: int(env.EMAIL_QUEUE_CONCURRENCY, 5),

    // DEV/TEST ONLY: when true, /send includes the OTP in the response so the
    // full send->match flow can be exercised without reading the email.
    exposeOtpInResponse: bool(env.OTP_EXPOSE_IN_RESPONSE, false),

    limitSendIpWindowMs: int(env.RATE_LIMIT_SEND_IP_WINDOW_MS, 3600000),
    limitSendIpMax: int(env.RATE_LIMIT_SEND_IP_MAX, 5),
    limitSendEmailWindowMs: int(env.RATE_LIMIT_SEND_EMAIL_WINDOW_MS, 600000),
    limitSendEmailMax: int(env.RATE_LIMIT_SEND_EMAIL_MAX, 3),
    limitMatchWindowMs: int(env.RATE_LIMIT_MATCH_WINDOW_MS, 900000),
    limitMatchMax: int(env.RATE_LIMIT_MATCH_MAX, 10),
  };
}

module.exports = { loadConfig };
