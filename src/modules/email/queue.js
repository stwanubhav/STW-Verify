const { WorkerQueue } = require('../../lib/workerQueue');

/**
 * Wraps an EmailService so sends are queued and processed with bounded
 * concurrency. The API handler awaits the job promise, so it still returns
 * 200 only on actual delivery and 502 on failure — but a burst of /send
 * requests is processed non-blockingly without exhausting SMTP connections.
 */
class QueuedEmailService {
  constructor(emailService, { concurrency = 5 } = {}) {
    this._queue = new WorkerQueue({
      concurrency,
      worker: ({ to, otp }) => emailService.sendOtpEmail(to, otp),
    });
  }

  sendOtpEmail(to, otp) {
    return this._queue.push({ to, otp });
  }

  get pending() {
    return this._queue.pending;
  }
}

module.exports = { QueuedEmailService };
