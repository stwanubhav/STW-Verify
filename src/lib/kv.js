const fs = require('fs');
const path = require('path');

/**
 * Minimal JSON document store.
 *
 * dev / local     -> FileKV (under data/kv)
 * Vercel/edge     -> RedisKV backed by Upstash Redis (serverless, persistent)
 *
 * Both expose the same async interface: get/set/delete.
 */
function safeName(key) {
  return String(key).replace(/[^a-zA-Z0-9._-]/g, '_');
}

class FileKV {
  constructor(dir) {
    this.dir = dir;
  }

  _file(key) {
    return path.join(this.dir, `${safeName(key)}.json`);
  }

  async get(key) {
    try {
      return JSON.parse(fs.readFileSync(this._file(key), 'utf8'));
    } catch {
      return null;
    }
  }

  async set(key, value) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this._file(key), JSON.stringify(value, null, 2), 'utf8');
  }

  async delete(key) {
    try {
      fs.unlinkSync(this._file(key));
    } catch {
      // ignore
    }
  }
}

class RedisKV {
  constructor(redis, prefix = 'kv:') {
    this.redis = redis;
    this.prefix = prefix;
  }

  async get(key) {
    const raw = await this.redis.get(this.prefix + key);
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async set(key, value) {
    await this.redis.set(this.prefix + key, JSON.stringify(value));
  }

  async delete(key) {
    await this.redis.del(this.prefix + key);
  }
}

/**
 * Used when a redis backend is requested but no Upstash token is configured.
 * Every op fails with a clear, classifiable message instead of a generic 500.
 */
class FailingKV {
  constructor(message) {
    this.message = message;
  }

  _fail() {
    const err = new Error(this.message);
    err.code = 'KV_UNAVAILABLE';
    err.status = 503;
    throw err;
  }

  async get() {
    this._fail();
  }

  async set() {
    this._fail();
  }

  async delete() {
    this._fail();
  }
}

module.exports = { FileKV, RedisKV, FailingKV };
