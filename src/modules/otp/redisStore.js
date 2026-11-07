const Redis = require('ioredis');
const logger = require('../../lib/logger');

/**
 * Atomic "create/replace" script. Stores the record as a hash with a TTL so
 * expired OTPs are invalidated automatically by Redis. Runs as one atomic
 * operation (no read-modify-write race).
 */
const SET_OTP_LUA = `
local key = KEYS[1]
local email = ARGV[1]
local h = ARGV[2]
local salt = ARGV[3]
local ttl = tonumber(ARGV[4])
redis.call('HSET', key, 'email', email, 'h', h, 'salt', salt, 'attempts', 0)
redis.call('EXPIRE', key, ttl)
return 1
`;

/**
 * Atomic verification script. Performs compare, attempt counting, lockout
 * and delete-on-success atomically, so simultaneous verification requests for
 * the same OTP cannot both succeed (exactly-once verification).
 *
 * Returns [1, "verified"] on success; otherwise [0, reason] where reason is
 * "missing" | "changed" | "wrong" | "locked".
 */
const VERIFY_OTP_LUA = `
local key = KEYS[1]
local candidateHash = ARGV[1]
local expectedHash = ARGV[2]
local maxAttempts = tonumber(ARGV[3])

local rec = redis.call('HGETALL', key)
if #rec == 0 then
  return {0, 'missing'}
end

local storedHash = ''
local attempts = 0
for i = 1, #rec, 2 do
  if rec[i] == 'h' then
    storedHash = rec[i + 1]
  elseif rec[i] == 'attempts' then
    attempts = tonumber(rec[i + 1]) or 0
  end
end

-- The record changed since the caller read it (new send or consumed by
-- another verifier) -> treat as not verified.
if storedHash ~= expectedHash then
  return {0, 'changed'}
end

if storedHash == candidateHash then
  redis.call('DEL', key)
  return {1, 'verified'}
end

attempts = attempts + 1
if attempts >= maxAttempts then
  redis.call('DEL', key)
  return {0, 'locked'}
end

redis.call('HSET', key, 'attempts', attempts)
return {0, 'wrong'}
`;

class RedisOtpStore {
  constructor({ url, keyPrefix = 'otp:' }) {
    this.keyPrefix = keyPrefix;
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: true,
      // Auto-reconnect with jittered exponential backoff so the client
      // recovers automatically when Redis comes back, without a restart.
      retryStrategy: (times) => {
        if (times > 20) return null;
        const base = Math.min(100 * 2 ** (times - 1), 5000);
        return Math.floor(base + Math.random() * 200);
      },
    });
    this.client.on('error', (err) => {
      logger.error('[redis] connection error', err.message);
    });
  }

  _key(key) {
    return this.keyPrefix + key;
  }

  async set(key, record, ttlMs) {
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.client.eval(
      SET_OTP_LUA,
      1,
      this._key(key),
      record.email,
      record.otpHash,
      record.salt,
      ttlSec,
    );
  }

  async get(key) {
    const rec = await this.client.hgetall(this._key(key));
    if (!rec || Object.keys(rec).length === 0) return null;
    return {
      email: rec.email,
      otpHash: rec.h,
      salt: rec.salt,
      attempts: parseInt(rec.attempts, 10) || 0,
    };
  }

  async delete(key) {
    await this.client.del(this._key(key));
  }

  async verifyFinalize(key, { candidateHash, expectedHash, maxAttempts }) {
    const res = await this.client.eval(
      VERIFY_OTP_LUA,
      1,
      this._key(key),
      candidateHash,
      expectedHash,
      String(maxAttempts),
    );
    return { code: Number(res[0]), reason: String(res[1]) };
  }

  async close() {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

module.exports = { RedisOtpStore, SET_OTP_LUA, VERIFY_OTP_LUA };
