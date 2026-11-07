const { Redis } = require('@upstash/redis');

/**
 * Atomic "create/replace" script (same semantics as the ioredis store).
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
 * Atomic verification script: compare + attempt counting + lockout + delete.
 * Exactly-once verification under concurrency.
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

/**
 * Serverless OTP store for Vercel using Upstash Redis (HTTP-based).
 * Same interface as MemoryOtpStore / RedisOtpStore.
 */
class UpstashOtpStore {
  constructor({ url, token, keyPrefix = 'otp:' }) {
    this.keyPrefix = keyPrefix;
    this.redis = new Redis({ url, token });
  }

  _key(key) {
    return this.keyPrefix + key;
  }

  async set(key, record, ttlMs) {
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.redis.eval(SET_OTP_LUA, [this._key(key)], [
      record.email,
      record.otpHash,
      record.salt,
      String(ttlSec),
    ]);
  }

  async get(key) {
    const rec = await this.redis.hgetall(this._key(key));
    if (!rec || Object.keys(rec).length === 0) return null;
    return {
      email: rec.email,
      otpHash: rec.h,
      salt: rec.salt,
      attempts: parseInt(rec.attempts, 10) || 0,
    };
  }

  async delete(key) {
    await this.redis.del(this._key(key));
  }

  async verifyFinalize(key, { candidateHash, expectedHash, maxAttempts }) {
    const res = await this.redis.eval(VERIFY_OTP_LUA, [this._key(key)], [
      candidateHash,
      expectedHash,
      String(maxAttempts),
    ]);
    return { code: Number(res[0]), reason: String(res[1]) };
  }

  async close() {
    // Upstash HTTP client has no persistent socket to close.
  }
}

module.exports = { UpstashOtpStore, SET_OTP_LUA, VERIFY_OTP_LUA };
