const crypto = require('crypto');
const logger = require('../../lib/logger');

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

const GMAIL_RE = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;

function isGmail(email) {
  return GMAIL_RE.test(normalizeEmail(email));
}

function hashOtp(otp, salt) {
  return crypto.createHash('sha256').update(`${salt}:${otp}`).digest('hex');
}

function createAppError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function storeUnavailable() {
  return createAppError('STORE_UNAVAILABLE', 'OTP storage is temporarily unavailable', 503);
}

class OtpService {
  constructor({ store, emailService, config }) {
    this.store = store;
    this.emailService = emailService;
    this.config = config;
  }

  generateOtp() {
    const { otpMin, otpMax } = this.config;
    return crypto.randomInt(otpMin, otpMax + 1);
  }

  /**
   * Generate, store and email an OTP for the given address. Each request gets
   * a unique `token`; the record is stored under that token so multiple
   * concurrent auth flows for the same email never overwrite each other.
   * @returns {Promise<{email: string, token: string}>}
   */
  async sendOtp(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!email) {
      throw createAppError('INVALID_EMAIL', 'Email is required', 400);
    }
    if (!isGmail(email)) {
      throw createAppError('INVALID_EMAIL', 'A valid Gmail address is required', 400);
    }

    const otp = this.generateOtp();
    const token = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString('hex');
    const record = {
      email,
      otpHash: hashOtp(String(otp), salt),
      salt,
    };

    try {
      await this.store.set(token, record, this.config.otpTtlMs);
    } catch (err) {
      logger.error('OTP storage unavailable (set)', err);
      throw storeUnavailable();
    }

    // Email delivery is queued and non-blocking (bounded concurrency). We await
    // the specific job so 200 is only returned after actual delivery.
    try {
      await this.emailService.sendOtpEmail(email, otp);
    } catch (err) {
      await this.store.delete(token).catch(() => {});
      logger.error('OTP email delivery failed', err);
      throw createAppError('EMAIL_SEND_FAILED', 'Failed to send OTP email', 502);
    }

    const result = { email, token };
    if (this.config.exposeOtpInResponse) {
      result.otp = otp;
    }
    return result;
  }

  /**
   * Verify a submitted OTP against the record owned by `token`.
   *
   * The store's `verifyFinalize` performs compare + attempt counting + lockout
   * + delete atomically, guaranteeing a given OTP verifies exactly once even
   * under concurrent requests.
   *
   * Status semantics per spec:
   *   - verified + unexpired -> { verified: true }   (HTTP 404)
   *   - anything else          -> { verified: false } (HTTP 200)
   *
   * @param {string} rawEmail the gmail address
   * @param {string} token the request token returned by /send
   * @param {string|number} rawOtp the OTP to check
   * @returns {Promise<{verified: boolean}>}
   */
  async verifyOtp(rawEmail, token, rawOtp) {
    const email = normalizeEmail(rawEmail);
    if (!email || !isGmail(email)) {
      return { verified: false };
    }
    if (typeof token !== 'string' || !token.trim()) {
      return { verified: false };
    }

    const submitted = typeof rawOtp === 'string' ? rawOtp.trim() : String(rawOtp ?? '');
    if (!/^\d{4}$/.test(submitted)) {
      return { verified: false };
    }

    let record;
    try {
      record = await this.store.get(token);
    } catch (err) {
      logger.error('OTP storage unavailable (get)', err);
      throw storeUnavailable();
    }

    if (!record || record.email !== email) {
      return { verified: false };
    }

    const candidateHash = hashOtp(submitted, record.salt);

    let outcome;
    try {
      outcome = await this.store.verifyFinalize(token, {
        candidateHash,
        expectedHash: record.otpHash,
        maxAttempts: this.config.verifyMaxAttempts,
      });
    } catch (err) {
      logger.error('OTP storage unavailable (verify)', err);
      throw storeUnavailable();
    }

    return { verified: outcome.code === 1 };
  }
}

module.exports = { OtpService, normalizeEmail, isGmail, hashOtp, createAppError };
