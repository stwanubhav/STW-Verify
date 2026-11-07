const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('../../lib/crypto');
const { storageUnavailable } = require('../../lib/errors');

/**
 * Admin authentication for the settings panel.
 *
 * Defaults (admin@gmail.com / admin123) are accepted ONLY until the admin
 * configures their own credentials (scrypt-hashed, stored in KV). After that
 * the defaults are removed.
 *
 * Sessions are stateless HMAC-signed tokens (serverless-safe). A token is
 * validated by signature + expiry; logout clears the client cookie.
 */
class AuthService {
  constructor({ kv, key = 'admin', defaultEmail = 'admin@gmail.com', defaultPass = 'admin123', sessionTtlMs = 43200000, secretKey }) {
    this.kv = kv;
    this.key = key;
    this.defaultEmail = defaultEmail;
    this.defaultPass = defaultPass;
    this.sessionTtlMs = sessionTtlMs;
    this.secretKey = secretKey;
    this._cache = null;
  }

  async _load() {
    if (this._cache) return this._cache;
    let stored = {};
    try {
      const value = await this.kv.get(this.key);
      if (value && typeof value === 'object') stored = value;
    } catch {
      stored = {};
    }

    // Migrate legacy plaintext password documents.
    if (stored.password && !stored.passwordHash) {
      const { salt, hash } = hashPassword(stored.password);
      stored = { email: stored.email, salt, passwordHash: hash };
      await this.kv.set(this.key, stored);
    }

    this._cache = stored;
    return stored;
  }

  async isConfigured() {
    const stored = await this._load();
    return Boolean(stored && stored.configured);
  }

  async verify(email, password) {
    const mail = String(email ?? '').trim().toLowerCase();
    const stored = await this._load();

    if (!stored || !stored.configured) {
      return mail === String(this.defaultEmail).trim().toLowerCase() && String(password ?? '') === String(this.defaultPass);
    }

    if (mail !== String(stored.email).trim().toLowerCase()) return false;
    return verifyPassword(password, stored.salt, stored.passwordHash);
  }

  async email() {
    const stored = await this._load();
    return stored && stored.configured ? stored.email : this.defaultEmail;
  }

  _sign(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.secretKey).update(data).digest('base64url');
    return `${data}.${sig}`;
  }

  issueSession(email) {
    const now = Math.floor(Date.now() / 1000);
    return this._sign({
      sub: String(email),
      iat: now,
      exp: now + Math.floor(this.sessionTtlMs / 1000),
    });
  }

  isValid(token) {
    if (!token) return false;
    const [data, sig] = String(token).split('.');
    if (!data || !sig) return false;
    const expected = crypto.createHmac('sha256', this.secretKey).update(data).digest('base64url');
    if (sig !== expected) return false;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    } catch {
      return false;
    }
    return Number(payload.exp) >= Math.floor(Date.now() / 1000);
  }

  revoke() {
    // Stateless: nothing to invalidate server-side.
  }

  emailFromToken(token) {
    const [data] = String(token).split('.');
    if (!data) return '';
    try {
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
      return payload.sub || '';
    } catch {
      return '';
    }
  }

  async changeCredentials({ currentPassword, newEmail, newPassword }) {
    const stored = await this._load();
    const configured = Boolean(stored && stored.configured);

    const currentOk = configured
      ? verifyPassword(currentPassword, stored.salt, stored.passwordHash)
      : String(currentPassword ?? '') === String(this.defaultPass);

    if (!currentOk) {
      const err = new Error('Current password is incorrect');
      err.code = 'BAD_CURRENT_PASS';
      err.status = 401;
      throw err;
    }

    const email = String(newEmail ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const err = new Error('A valid email address is required');
      err.code = 'INVALID_CREDENTIALS';
      err.status = 400;
      throw err;
    }

    const pass = String(newPassword ?? '');
    if (pass.length < 6) {
      const err = new Error('Password must be at least 6 characters');
      err.code = 'INVALID_CREDENTIALS';
      err.status = 400;
      throw err;
    }

    const { salt, hash } = hashPassword(pass);
    const doc = { email, salt, passwordHash: hash, configured: true };
    try {
      await this.kv.set(this.key, doc);
    } catch (err) {
      if (err.code === 'KV_UNAVAILABLE') throw err;
      throw storageUnavailable('save admin credentials');
    }
    this._cache = doc;
    return { email };
  }
}

module.exports = { AuthService };
