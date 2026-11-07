const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

const DEFAULT_ENV = {
  EMAIL_TRANSPORT: 'console',
  OTP_TTL_MS: '300000',
  OTP_LENGTH: '4',
  OTP_MIN: '1000',
  OTP_MAX: '9999',
  RATE_LIMIT_SEND_IP_WINDOW_MS: '3600000',
  RATE_LIMIT_SEND_IP_MAX: '100',
  RATE_LIMIT_SEND_EMAIL_WINDOW_MS: '600000',
  RATE_LIMIT_SEND_EMAIL_MAX: '100',
  RATE_LIMIT_MATCH_WINDOW_MS: '900000',
  RATE_LIMIT_MATCH_MAX: '100',
};

function withServer(envOverrides, fn) {
  return async () => {
    const app = createApp({ env: { ...DEFAULT_ENV, ...envOverrides } });

    const spy = { sent: [] };
    spy.sendOtpEmail = async (to, otp) => {
      spy.sent.push({ to, otp });
      return { messageId: 'test', accepted: [to] };
    };
    app.locals.otpService.emailService = spy;

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
      await fn({ request, spy });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

const GMAIL = 'user.test@gmail.com';

test('GET /health returns 200', withServer({}, async ({ request }) => {
  const res = await request('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
}));

test('/send returns 200 with a token, emails OTP, and never leaks OTP', withServer({}, async ({ request, spy }) => {
  const res = await request('POST', '/api/otp/send', { email: GMAIL });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  assert.equal(typeof res.body.token, 'string');
  assert.ok(res.body.token.length > 0);

  assert.equal(spy.sent.length, 1);
  assert.equal(spy.sent[0].to, GMAIL);
  const otp = String(spy.sent[0].otp);
  assert.match(otp, /^[1-9]\d{3}$/);

  assert.ok(!JSON.stringify(res.body).includes(otp));
  assert.ok(!res.body.otp);
  assert.notEqual(res.body.token, otp);
}));

test('/send does NOT expose the OTP by default', withServer({}, async ({ request }) => {
  const res = await request('POST', '/api/otp/send', { email: GMAIL });
  assert.equal(res.status, 200);
  assert.equal(res.body.otp, undefined);
}));

test('/send exposes OTP only when OTP_EXPOSE_IN_RESPONSE=true', withServer(
  { OTP_EXPOSE_IN_RESPONSE: 'true' },
  async ({ request, spy }) => {
    const res = await request('POST', '/api/otp/send', { email: GMAIL });
    assert.equal(res.status, 200);
    const sentOtp = String(spy.sent[0].otp);
    assert.equal(String(res.body.otp), sentOtp);

    const match = await request('POST', '/api/otp/match', {
      email: GMAIL,
      token: res.body.token,
      otp: res.body.otp,
    });
    assert.equal(match.status, 404);
  },
));

test('/send returns 400 for invalid Gmail addresses', withServer({}, async ({ request }) => {
  for (const email of ['not-an-email', 'user@yahoo.com', 'user@', '@gmail.com', '', undefined]) {
    const res = await request('POST', '/api/otp/send', { email });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(email)}`);
    assert.equal(res.body.success, false);
  }
}));

test('/match returns 404 for correct OTP with its token, then invalidates it', withServer({}, async ({ request, spy }) => {
  const sent = await request('POST', '/api/otp/send', { email: GMAIL });
  const { token } = sent.body;
  const otp = String(spy.sent[0].otp);

  const ok = await request('POST', '/api/otp/match', { email: GMAIL, token, otp });
  assert.equal(ok.status, 404, 'successful verification must return 404');
  assert.equal(ok.body.success, true);

  const reuse = await request('POST', '/api/otp/match', { email: GMAIL, token, otp });
  assert.equal(reuse.status, 200, 'reused OTP must return 200');
  assert.equal(reuse.body.success, false);
}));

test('/match returns 200 for wrong OTP', withServer({}, async ({ request, spy }) => {
  const sent = await request('POST', '/api/otp/send', { email: GMAIL });
  const { token } = sent.body;
  const otp = String(spy.sent[0].otp);
  const wrong = otp === '9999' ? '1111' : '9999';

  const res = await request('POST', '/api/otp/match', { email: GMAIL, token, otp: wrong });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, false);
}));

test('/match returns 200 for expired OTP', withServer({ OTP_TTL_MS: '100' }, async ({ request, spy }) => {
  const sent = await request('POST', '/api/otp/send', { email: GMAIL });
  const { token } = sent.body;
  const otp = String(spy.sent[0].otp);

  await new Promise((r) => setTimeout(r, 200));

  const res = await request('POST', '/api/otp/match', { email: GMAIL, token, otp });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, false);
}));

test('/match returns 200 when token is missing or unknown', withServer({}, async ({ request }) => {
  const noToken = await request('POST', '/api/otp/match', { email: GMAIL, otp: '1234' });
  assert.equal(noToken.status, 200);
  assert.equal(noToken.body.success, false);

  const unknown = await request('POST', '/api/otp/match', { email: GMAIL, token: 'does-not-exist', otp: '1234' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.success, false);
}));

test('concurrent OTPs for same email do not conflict (token scoping)', withServer({}, async ({ request, spy }) => {
  const first = await request('POST', '/api/otp/send', { email: GMAIL });
  const second = await request('POST', '/api/otp/send', { email: GMAIL });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.body.token, second.body.token);

  const otp1 = String(spy.sent[0].otp);
  const otp2 = String(spy.sent[1].otp);

  const v1 = await request('POST', '/api/otp/match', { email: GMAIL, token: first.body.token, otp: otp1 });
  assert.equal(v1.status, 404);

  const v2 = await request('POST', '/api/otp/match', { email: GMAIL, token: second.body.token, otp: otp2 });
  assert.equal(v2.status, 404);

  const cross = await request('POST', '/api/otp/match', { email: GMAIL, token: second.body.token, otp: otp1 });
  assert.equal(cross.status, 200);
  assert.equal(cross.body.success, false);
}));

test('rate limiting blocks excessive /send requests per IP', withServer(
  { RATE_LIMIT_SEND_IP_MAX: '3' },
  async ({ request }) => {
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await request('POST', '/api/otp/send', { email: `u${i}@gmail.com` });
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.success, false);
  },
));

test('rate limiting blocks excessive /match attempts per email', withServer(
  { RATE_LIMIT_MATCH_MAX: '3' },
  async ({ request }) => {
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await request('POST', '/api/otp/match', { email: GMAIL, token: `t${i}`, otp: '1111' });
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.success, false);
  },
));
