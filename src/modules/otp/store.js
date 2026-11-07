/**
 * OTP store interface. Backends must implement:
 *
 *   set(key, record, ttlMs)            -> Promise
 *   get(key)                           -> Promise<record|null>
 *   delete(key)                        -> Promise
 *   verifyFinalize(key, { candidateHash, expectedHash, maxAttempts })
 *                                      -> Promise<{code, reason}>
 *
 * `verifyFinalize` performs the ENTIRE verification (compare, attempts
 * counter, lockout, delete-on-success) as one atomic step so simultaneous
 * verification requests for the same OTP can never both succeed.
 *
 *   code 1 = verified (record deleted)
 *   code 0 = not verified; reason is one of:
 *            "missing" | "changed" | "wrong" | "locked"
 *
 * This in-memory implementation is atomic because Node runs it synchronously
 * on a single thread: no `await` separates reading, mutating, and deleting
 * the record, so no other request can interleave inside the critical section.
 */
class MemoryOtpStore {
  constructor() {
    this._records = new Map();
  }

  async set(key, record, ttlMs) {
    this._records.set(key, {
      email: record.email,
      otpHash: record.otpHash,
      salt: record.salt,
      attempts: 0,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async get(key) {
    const rec = this._records.get(key);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      this._records.delete(key);
      return null;
    }
    return {
      email: rec.email,
      otpHash: rec.otpHash,
      salt: rec.salt,
      attempts: rec.attempts,
    };
  }

  async delete(key) {
    this._records.delete(key);
  }

  async verifyFinalize(key, { candidateHash, expectedHash, maxAttempts }) {
    const rec = this._records.get(key);
    if (!rec) return { code: 0, reason: 'missing' };

    if (rec.expiresAt <= Date.now()) {
      this._records.delete(key);
      return { code: 0, reason: 'missing' };
    }

    // The record changed after the caller read it (e.g. a new send replaced
    // it, or another verifier already consumed it) -> treat as not verified.
    if (rec.otpHash !== expectedHash) {
      return { code: 0, reason: 'changed' };
    }

    if (rec.otpHash === candidateHash) {
      this._records.delete(key);
      return { code: 1, reason: 'verified' };
    }

    rec.attempts += 1;
    if (rec.attempts >= maxAttempts) {
      this._records.delete(key);
      return { code: 0, reason: 'locked' };
    }

    return { code: 0, reason: 'wrong' };
  }

  purgeExpired(now = Date.now()) {
    let purged = 0;
    for (const [key, rec] of this._records) {
      if (rec.expiresAt <= now) {
        this._records.delete(key);
        purged += 1;
      }
    }
    return purged;
  }

  size() {
    return this._records.size;
  }

  clear() {
    this._records.clear();
  }
}

module.exports = { MemoryOtpStore };
