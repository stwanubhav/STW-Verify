const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

const DEFAULT_ENV = {
  EMAIL_TRANSPORT: 'console',
  OTP_TTL_MS: '300000',
  OTP_LENGTH: '4',
  OTP_MIN: '1000',
  OTP_MAX: '9999',
  VERIFY_MAX_ATTEMPTS: '5',
  RATE_LIMIT_SEND_IP_WINDOW_MS: '3600000',
  RATE_LIMIT_SEND_IP_MAX: '10000',
  RATE_LIMIT_SEND_EMAIL_WINDOW_MS: '600000',
  RATE_LIMIT_SEND_EMAIL_MAX: '10000',
  RATE_LIMIT_MATCH_WINDOW_MS: '900000',
  RATE_LIMIT_MATCH_MAX: '10000',
};

function withServer(envOverrides, fn) {
  return async () => {
    const env = { ...DEFAULT_ENV, OTP_EXPOSE_IN_RESPONSE: 'true', ...envOverrides };
    const app = createApp({ env });

    const server = app.listen(0);
    await new Promise((resolve) => server.on('listening', resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

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
      await fn({ request, app, base });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

test('100 concurrent /send requests for distinct emails all succeed with unique tokens', withServer({}, async ({ request }) => {
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, i) => request('POST', '/api/otp/send', { email: `user${i}@gmail.com` })),
  );

  for (const r of results) {
    assert.equal(r.status, 200, `expected 200 for send, got ${r.status}`);
    assert.equal(r.body.success, true);
    assert.equal(typeof r.body.token, 'string');
  }

  const tokens = new Set(results.map((r) => r.body.token));
  assert.equal(tokens.size, 100, 'all tokens must be distinct');
}));

test('100 concurrent /send requests for the SAME email create independent sessions', withServer({}, async ({ request }) => {
  const results = await Promise.all(
    Array.from({ length: 100 }, () => request('POST', '/api/otp/send', { email: 'same@gmail.com' })),
  );

  for (const r of results) {
    assert.equal(r.status, 200);
  }
  const tokens = new Set(results.map((r) => r.body.token));
  assert.equal(tokens.size, 100, 'each /send must yield its own token');
}));

test('100 concurrent /match for the same OTP: exactly one succeeds (404)', withServer({}, async ({ request }) => {
  const sent = await request('POST', '/api/otp/send', { email: 'race@gmail.com' });
  assert.equal(sent.status, 200);
  const { token, otp } = sent.body;
  const email = 'race@gmail.com';

  const results = await Promise.all(
    Array.from({ length: 100 }, () => request('POST', '/api/otp/match', { email, token, otp })),
  );

  const ok = results.filter((r) => r.status === 404);
  const fails = results.filter((r) => r.status === 200);
  assert.equal(ok.length, 1, `expected exactly one success, got ${ok.length}`);
  assert.equal(fails.length, 99);

  const after = await request('POST', '/api/otp/match', { email, token, otp });
  assert.equal(after.status, 200);
  assert.equal(after.body.success, false);
}));

test('OTP is invalidated after 5 incorrect attempts (correct OTP then fails)', withServer({}, async ({ request }) => {
  const sent = await request('POST', '/api/otp/send', { email: 'lockout@gmail.com' });
  const { token, otp } = sent.body;
  const email = 'lockout@gmail.com';

  const wrong = otp === '1111' ? '2222' : '1111';

  for (let i = 0; i < 5; i += 1) {
    const r = await request('POST', '/api/otp/match', { email, token, otp: wrong });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, false);
  }

  const correct = await request('POST', '/api/otp/match', { email, token, otp });
  assert.equal(correct.status, 200);
  assert.equal(correct.body.success, false);
}));

test('/send returns 503 when the store is unavailable', withServer({}, async ({ request, app }) => {
  app.locals.otpService.store = {
    set: async () => { throw new Error('store down'); },
    delete: async () => {},
  };
  const res = await request('POST', '/api/otp/send', { email: 'down@gmail.com' });
  assert.equal(res.status, 503);
  assert.equal(res.body.success, false);
}));

test('/match returns 503 when the store is unavailable', withServer({}, async ({ request, app }) => {
  app.locals.otpService.store = {
    get: async () => { throw new Error('store down'); },
    verifyFinalize: async () => { throw new Error('store down'); },
  };
  const res = await request('POST', '/api/otp/match', { email: 'down@gmail.com', token: 'x', otp: '1234' });
  assert.equal(res.status, 503);
  assert.equal(res.body.success, false);
}));

test('server stays responsive after a concurrency storm', withServer({}, async ({ request }) => {
  await Promise.all(
    Array.from({ length: 200 }, (_, i) =>
      i % 2 === 0
        ? request('POST', '/api/otp/send', { email: `a${i}@gmail.com` })
        : request('POST', '/api/otp/match', { email: `b${i}@gmail.com`, token: 'x', otp: '1234' }),
    ),
  );

  const health = await request('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
}));
