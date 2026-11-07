const fs = require('fs');
const dotenv = require('dotenv');
const { encryptSecret, decryptSecret } = require('../../lib/crypto');
const { storageUnavailable } = require('../../lib/errors');

/**
 * SMTP sender credentials.
 *
 * The app password is AES-256-GCM encrypted at rest. The document lives in KV
 * (file locally, Upstash on Vercel). EMAIL_USER / EMAIL_PASS from `.env` are
 * used only as a fallback when no configured document exists.
 */
function placeholder(v) {
  return !v || /your|changeme|xxx|example|future\.\.\./i.test(String(v));
}

class SmtpCredentialsService {
  constructor({ kv, key = 'smtp-credentials', envFilePath, secretKey, fallbackUser = '', fallbackPass = '', syncEnv = true }) {
    this.kv = kv;
    this.key = key;
    this.envFilePath = envFilePath;
    this.secretKey = secretKey;
    this.fallbackUser = fallbackUser;
    this.fallbackPass = fallbackPass;
    this.syncEnv = syncEnv;
    this._cache = null;
  }

  _readEnv() {
    let parsed = {};
    try {
      if (fs.existsSync(this.envFilePath)) {
        parsed = dotenv.parse(fs.readFileSync(this.envFilePath, 'utf8'));
      }
    } catch {
      parsed = {};
    }
    return { user: parsed.EMAIL_USER || '', pass: parsed.EMAIL_PASS || '' };
  }

  _filePass(stored) {
    if (!stored.emailPass) return '';
    if (typeof stored.emailPass === 'string') return stored.emailPass; // legacy plaintext
    return decryptSecret(stored.emailPass, this.secretKey);
  }

  async load() {
    if (this._cache) return this._cache;

    let stored = {};
    try {
      const value = await this.kv.get(this.key);
      if (value && typeof value === 'object') stored = value;
    } catch {
      stored = {};
    }

    const fileUser = stored.emailUser ? String(stored.emailUser).trim() : '';
    const filePass = this._filePass(stored);

    let result;
    if (fileUser && filePass) {
      result = { emailUser: fileUser, emailPass: filePass, source: 'file' };
    } else {
      const env = this._readEnv();
      if (!placeholder(env.user) && !placeholder(env.pass)) {
        result = { emailUser: env.user, emailPass: env.pass, source: 'env' };
      } else {
        result = { emailUser: this.fallbackUser, emailPass: this.fallbackPass, source: 'env' };
      }
    }

    this._cache = result;
    return result;
  }

  get() {
    return this.load();
  }

  async save({ emailUser, emailPass }) {
    const user = typeof emailUser === 'string' ? emailUser.trim() : '';
    const pass = typeof emailPass === 'string' ? emailPass : '';

    if (!user || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) {
      const err = new Error('A valid sender Gmail address is required');
      err.code = 'INVALID_SMTP';
      err.status = 400;
      throw err;
    }
    if (!pass) {
      const err = new Error('App password is required');
      err.code = 'INVALID_SMTP';
      err.status = 400;
      throw err;
    }

    const doc = { emailUser: user, emailPass: encryptSecret(pass, this.secretKey) };
    try {
      await this.kv.set(this.key, doc);
    } catch (err) {
      if (err.code === 'KV_UNAVAILABLE') throw err;
      throw storageUnavailable('save SMTP credentials');
    }
    this._cache = { emailUser: user, emailPass: pass, source: 'file' };

    if (this.syncEnv) this._writeEnvUser(user);

    return { emailUser: user };
  }

  _writeEnvUser(user) {
    try {
      if (!fs.existsSync(this.envFilePath)) return;
      let text = fs.readFileSync(this.envFilePath, 'utf8');
      const re = /^EMAIL_USER=.*$/m;
      if (re.test(text)) {
        text = text.replace(re, `EMAIL_USER=${user}`);
      } else {
        text += (text && !text.endsWith('\n') ? '\n' : '') + `EMAIL_USER=${user}\n`;
      }
      fs.writeFileSync(this.envFilePath, text, 'utf8');
    } catch {
      // best-effort (only available in local/file mode)
    }
  }

  async public() {
    const c = await this.load();
    const configured = Boolean(c.emailUser && c.emailPass);
    let emailUser = '';
    if (c.emailUser) {
      const at = c.emailUser.indexOf('@');
      const head = at > 2 ? c.emailUser.slice(0, 2) : c.emailUser.slice(0, 1);
      const domain = c.emailUser.slice(at);
      emailUser = `${head}***${domain}`;
    }
    return { configured, source: c.source, emailUser };
  }
}

module.exports = { SmtpCredentialsService };
