const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Shared crypto helpers:
 *  - scrypt salted hashing for passwords (one-way)
 *  - AES-256-GCM authenticated encryption for secrets that must be
 *    recoverable to be used (e.g. the SMTP app password)
 */

// Module-level key cache so concurrent instances share one key per file.
const keyCache = new Map();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  try {
    const calc = crypto.scryptSync(String(password), String(salt), 32);
    const expected = Buffer.from(String(hash), 'hex');
    return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
  } catch {
    return false;
  }
}

function normalizeKey(input) {
  if (Buffer.isBuffer(input)) return input.length === 32 ? input : crypto.createHash('sha256').update(input).digest();
  const s = String(input);
  let b;
  try {
    b = Buffer.from(s.replace(/-/g, ''), 'hex');
  } catch {
    b = null;
  }
  if (!b || b.length !== 32) b = crypto.createHash('sha256').update(s).digest();
  return b;
}

function getOrCreateKey(masterKey, keyFile) {
  if (masterKey) return normalizeKey(masterKey);

  const resolved = path.resolve(keyFile);
  if (keyCache.has(resolved)) return keyCache.get(resolved);

  let key;
  try {
    if (fs.existsSync(resolved)) {
      key = fs.readFileSync(resolved);
    }
  } catch {
    key = null;
  }
  if (!key || key.length !== 32) {
    key = crypto.randomBytes(32);
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, key, { mode: 0o600 });
    } catch {
      // If we cannot persist, keep an in-memory key for this process.
    }
  }
  keyCache.set(resolved, key);
  return key;
}

function encryptSecret(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

function decryptSecret(payload, key) {
  if (!payload || !payload.data || !payload.iv) return '';
  try {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const data = Buffer.from(payload.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  getOrCreateKey,
  encryptSecret,
  decryptSecret,
};
