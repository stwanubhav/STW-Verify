/**
 * Minimal concurrency-limited worker queue.
 *
 * push(payload) returns a Promise that resolves/rejects when a worker has
 * finished that payload. The number of in-flight workers is bounded by
 * `concurrency`, so a burst of jobs (e.g. 100 simultaneous email sends) never
 * opens 100 sockets at once and never blocks the event loop.
 */
class WorkerQueue {
  constructor({ concurrency, worker }) {
    this.concurrency = Math.max(1, concurrency);
    this.worker = worker;
    this._jobs = [];
    this._active = 0;
  }

  push(payload) {
    return new Promise((resolve, reject) => {
      this._jobs.push({ payload, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this._active < this.concurrency && this._jobs.length > 0) {
      const job = this._jobs.shift();
      this._active += 1;
      this._run(job);
    }
  }

  async _run(job) {
    try {
      const result = await this.worker(job.payload);
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    } finally {
      this._active -= 1;
      this._drain();
    }
  }

  get pending() {
    return this._jobs.length + this._active;
  }
}

module.exports = { WorkerQueue };
