/**
 * Wraps any OTP store (memory or Redis) to add:
 *   - automatic retry of transient failures (connection/timeout) with backoff
 *   - health tracking so /health can report whether storage is up
 *
 * Retrying is safe here: the store operations are atomic/idempotent, so a
 * retried set/verify does not double-consume an OTP.
 */
const TRANSIENT_RE = /connection|timeout|closed|reconnect|offline|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|script execution/i;

function isTransient(err) {
  if (!err) return false;
  return TRANSIENT_RE.test(String(err.code || '')) || TRANSIENT_RE.test(String(err.message || ''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ResilientStore {
  constructor(backend, { retries = 3, baseDelayMs = 30 } = {}) {
    this.backend = backend;
    this.retries = retries;
    this.baseDelayMs = baseDelayMs;
    this.healthy = true;
    this.failures = 0;
    this.lastError = null;
  }

  async _call(fn, label) {
    let attempt = 0;
    for (;;) {
      try {
        const result = await fn();
        this.healthy = true;
        this.failures = 0;
        this.lastError = null;
        return result;
      } catch (err) {
        if (!isTransient(err) || attempt >= this.retries) {
          this._markDown(err, label);
          throw err;
        }
        attempt += 1;
        await sleep(this.baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 20));
      }
    }
  }

  _markDown(err, label) {
    this.healthy = false;
    this.failures += 1;
    this.lastError = `${label}: ${String(err.message || err)}`;
  }

  set(key, record, ttlMs) {
    return this._call(() => this.backend.set(key, record, ttlMs), 'set');
  }

  get(key) {
    return this._call(() => this.backend.get(key), 'get');
  }

  delete(key) {
    return this._call(() => this.backend.delete(key), 'delete');
  }

  verifyFinalize(key, opts) {
    return this._call(() => this.backend.verifyFinalize(key, opts), 'verify');
  }

  purgeExpired() {
    if (typeof this.backend.purgeExpired === 'function') return this.backend.purgeExpired();
    return 0;
  }

  status() {
    return {
      type: this.backend.constructor && this.backend.constructor.name,
      healthy: this.healthy,
      failures: this.failures,
      lastError: this.lastError,
    };
  }

  close() {
    if (typeof this.backend.close === 'function') return this.backend.close();
  }
}

module.exports = { ResilientStore, isTransient };
