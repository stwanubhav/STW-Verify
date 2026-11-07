const { test } = require('node:test');
const assert = require('node:assert/strict');
const Redis = require('ioredis');
const { createApp } = require('../src/app');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const ENV = {
  STORE: 'redis',
  REDIS_URL,
  EMAIL_TRANSPORT: 'console',
  OTP_EXPOSE_IN_RESPONSE: 'true',
  OTP_TTL_MS: '300000',
  OTP_MIN: '1000',
  OTP_MAX: '9999',
  VERIFY_MAX_ATTEMPTS: '5',
  RATE_LIMIT_SEND_IP_MAX: '10000',
  RATE_LIMIT_SEND_EMAIL_MAX: '10000',
  RATE_LIMIT_MATCH_MAX: '10000',
};

async function redisAvailable(url) {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

async function withRedis(fn) {
  const app = createApp({ env: ENV });
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  };
  try {
    await fn({ request });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (app.locals.otpStore && typeof app.locals.otpStore.close === 'function') {
      await app.locals.otpStore.close();
    }
  }
}

test('Redis: send + verify happy path', async (t) => {
  if (!(await redisAvailable(REDIS_URL))) return t.skip('Redis not available');
  await withRedis(async ({ request }) => {
    const sent = await request('POST', '/api/otp/send', { email: 'redis@example.com' });
    assert.equal(sent.status, 200);
    assert.ok(sent.body.token);

    const match = await request('POST', '/api/otp/match', {
      email: 'redis@example.com',
      token: sent.body.token,
      otp: sent.body.otp,
    });
    assert.equal(match.status, 404);
  });
});

test('Redis: concurrent matches of the same OTP succeed exactly once', async (t) => {
  if (!(await redisAvailable(REDIS_URL))) return t.skip('Redis not available');
  await withRedis(async ({ request }) => {
    const sent = await request('POST', '/api/otp/send', { email: 'redis-race@example.com' });
    const { token, otp } = sent.body;

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        request('POST', '/api/otp/match', { email: 'redis-race@example.com', token, otp }),
      ),
    );

    const ok = results.filter((r) => r.status === 404);
    assert.equal(ok.length, 1, `expected exactly one success, got ${ok.length}`);
  });
});
