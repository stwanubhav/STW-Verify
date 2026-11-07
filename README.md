# STW-Verify

A secure, production-structured OTP (One-Time Password) generation, email delivery,
and verification REST API built with Node.js + Express.

| Area | Implementation |
|------|----------------|
| Runtime | Node.js >= 18 (built/tested on Node 26) |
| Framework | Express 4 |
| Email | Nodemailer (Gmail SMTP) — or a `console` transport for local dev/test; async delivery queue (`EMAIL_QUEUE_CONCURRENCY`) |
| Storage | **Redis** (`RedisOtpStore`, atomic Lua scripts) or in-memory for dev/test. **Salted SHA-256 hashed** OTPs, 5-minute TTL (Redis EXPIRE / periodic purge) |
| Atomicity | Verification is a single atomic operation (`verifyFinalize`) → exactly-once OTP verification |
| Lockout | OTP invalidated after `VERIFY_MAX_ATTEMPTS` (default 5) incorrect attempts |
| Rate limiting | `express-rate-limit` (per-IP and per-email on `/send`; per-email on `/match`) |
| Tests | Node's built-in test runner (`node --test`) — 19 passing incl. concurrency, 2 Redis integration (skip without Redis) |

## Features

- **`POST /api/otp/send`** — validates a Gmail address, generates a random 4-digit
  OTP (1000–9999), stores it hashed for 5 minutes, emails it, returns `200`
  together with a **request token**.
- **`POST /api/otp/match`** — verifies the submitted OTP **scoped to the token**
  returned by `/send`. Per the specification:
  - OTP **correct** and unexpired → **HTTP 404** (and the record is deleted so it
    cannot be reused)
  - OTP wrong, expired, absent, or token invalid → **HTTP 200**
- **Concurrency-safe** — each `/send` creates an independent record keyed by a
  unique token. Multiple simultaneous auth flows for the same email never
  overwrite each other; each token can only verify its own OTP.
- **Exactly-once verification** — compare, attempt counting, lockout, and
  delete-on-success run as one atomic step (Redis Lua script / synchronous
  memory op). If 100 verification requests race on the same OTP, exactly one
  succeeds; the rest fail.
- **Async email queue** — outgoing sends are queued with bounded concurrency,
  so a burst of `/send` requests never blocks the event loop or exhausts SMTP
  connections. The response still reflects real delivery (200 / 502).
- **Store-failure handling** — if Redis is unreachable, `/send` and `/match`
  return `503` with a JSON error instead of crashing.
- The OTP is **never exposed in any API response** (only in the email, or in the
  server console when using the `console` transport in dev). The token is safe
  to expose — it is not the OTP.
- Secrets (email credentials, etc.) come from environment variables.

## Quick start (in-memory, dev)

```bash
cp .env.example .env
# edit .env -> set EMAIL_TRANSPORT=smtp, EMAIL_USER / EMAIL_PASS
#   (use a Gmail App Password, not your account password)
# leave STORE unset (defaults to memory) or set STORE=memory
npm install
npm start
# -> STW-Verify listening at http://localhost:3000
```

For local development without SMTP credentials, set `EMAIL_TRANSPORT=console`
(the OTP is printed to the server console).

```bash
npm test        # run the test suite
npm run dev     # run with auto-reload
```

## Production (Redis)

```bash
docker compose up -d redis        # start Redis on 127.0.0.1:6379
# set in .env:
#   STORE=redis
#   REDIS_URL=redis://127.0.0.1:6379
npm start
```

With `STORE=redis`, OTP records live in Redis as hashes with a TTL. Verification
uses an atomic Lua script, so the first concurrent match on an OTP wins and the
rest fail. The Redis integration tests run automatically when `REDIS_URL` points
at a reachable Redis (otherwise they skip).

## API

All requests/responses are JSON. All paths are relative to `BASE_URL`.

### `POST /api/otp/send`

Request body: `{ "email": "user@gmail.com" }`

| Outcome | HTTP | Body |
|---------|------|------|
| OTP generated, stored, and emailed | `200` | `{"success":true,"message":"OTP sent successfully. Check your inbox.","token":"<uuid>"}` |
| Invalid / missing / non-Gmail email | `400` | `{"success":false,"message":"A valid Gmail address is required"}` |
| Email delivery failure | `502` | `{"success":false,"message":"Failed to send OTP email"}` |
| Rate limit exceeded | `429` | `{"success":false,"message":"Too many..."}` |

### `POST /api/otp/match`

Request body: `{ "email": "user@gmail.com", "token": "<uuid from /send>", "otp": "1234" }`

> The `token` must be the one returned by the `/send` that generated this OTP.
> It scopes verification to that specific attempt (essential when multiple
> OTPs are in flight for the same email).

| Outcome | HTTP | Body |
|---------|------|------|
| OTP correct, unexpired, and token matches (record deleted) | `404` | `{"success":true,"message":"OTP verified successfully"}` |
| OTP wrong / expired / not found / token mismatch / locked out after 5 wrong attempts | `200` | `{"success":false,"message":"Invalid or expired OTP"}` |
| Rate limit exceeded | `429` | `{"success":false,"message":"Too many verification attempts. Try again later."}` |
| OTP storage unavailable (e.g. Redis down) | `503` | `{"success":false,"message":"OTP storage is temporarily unavailable"}` |

> Note: the `404`/`200` mapping is inverted from conventional REST semantics as
> explicitly requested. Clients should branch on `success`/status per this table.

## Example

```bash
# 1. Send an OTP -> returns a token
curl -X POST http://localhost:3000/api/otp/send \
  -H "Content-Type: application/json" \
  -d '{"email":"user@gmail.com"}'
# {"success":true,"message":"OTP sent successfully. Check your inbox.","token":"a1b2c3..."}

# 2. Verify it with its token (correct OTP -> 404)
curl -X POST http://localhost:3000/api/otp/match \
  -H "Content-Type: application/json" \
  -d '{"email":"user@gmail.com","token":"a1b2c3...","otp":"1382"}' -i
# HTTP/1.1 404 Not Found
# {"success":true,"message":"OTP verified successfully"}

# 3. Reuse / wrong OTP / wrong token -> 200
curl -X POST http://localhost:3000/api/otp/match \
  -H "Content-Type: application/json" \
  -d '{"email":"user@gmail.com","token":"a1b2c3...","otp":"1382"}' -i
# HTTP/1.1 200 OK
# {"success":false,"message":"Invalid or expired OTP"}
```

## Configuration (`.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `BASE_URL` | `http://localhost:3000` | Public base URL for the API |
| `NODE_ENV` | `development` | Environment name |
| `EMAIL_TRANSPORT` | `console` | `smtp` (production) or `console` (dev/test) |
| `EMAIL_HOST` | `smtp.gmail.com` | SMTP host |
| `EMAIL_PORT` | `465` | SMTP port (465 SSL / 587 STARTTLS) |
| `EMAIL_SECURE` | `true` | Use TLS |
| `EMAIL_USER` | — | Gmail address for SMTP auth |
| `EMAIL_PASS` | — | Gmail **App Password** (never your login password) |
| `EMAIL_FROM` | `STW-Verify <USER>` | From header |
| `OTP_TTL_MS` | `300000` | OTP lifetime (5 min) |
| `OTP_LENGTH` | `4` | Number of digits (kept at 4) |
| `OTP_MIN` / `OTP_MAX` | `1000` / `9999` | OTP range |
| `STORE` | `memory` (or `redis` if `REDIS_URL` set) | OTP backend: `memory` (dev/test) or `redis` |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection string (used when `STORE=redis`) |
| `VERIFY_MAX_ATTEMPTS` | `5` | Max incorrect attempts before the OTP is invalidated |
| `EMAIL_QUEUE_CONCURRENCY` | `5` | Max simultaneous SMTP sends (async queue); set `1` for direct serial delivery |
| `OTP_EXPOSE_IN_RESPONSE` | `false` | **Dev/test only.** When `true`, `/send` includes `otp` in the response so you can run send→match without reading the email. Keep `false` in production. |
| `RATE_LIMIT_SEND_IP_*` | 1h / 5 | Per-IP `/send` limit |
| `RATE_LIMIT_SEND_EMAIL_*` | 10min / 3 | Per-email `/send` limit |
| `RATE_LIMIT_MATCH_*` | 15min / 10 | Per-email `/match` limit (anti brute-force) |

## Security notes

- OTPs are stored as **salted SHA-256 hashes** — plaintext never touches storage.
- A successful `/match` deletes the record; expired records are purged by Redis
  TTL (or periodically/lazily in the memory store).
- Verification is **atomic**, so a given OTP verifies exactly once — duplicate or
  concurrent verification cannot double-succeed.
- An OTP is **invalidated after 5 incorrect attempts** (lockout), preventing
  brute-force.
- Rate limiting prevents generator abuse and brute-force verification.
- The OTP is never included in a response body.
- SMTP credentials and all secrets live in the environment; `.env` is gitignored.
- **Gmail**: use an [App Password](https://support.google.com/accounts/answer/185833)
  with `EMAIL_TRANSPORT=smtp`.

## Project layout

```
src/
  server.js                 # entry point (listens on PORT)
  app.js                    # createApp(config): selects store, wires email queue + routes
  config/index.js           # typed env config loaders (store, redis, queue, attempts)
  lib/
    logger.js               # console logger
    workerQueue.js          # bounded-concurrency async queue
  middleware/
    errorHandler.js         # JSON 404 + error responses
    rateLimit.js            # express-rate-limit factories
  modules/
    otp/
      store.js              # in-memory store — atomic verifyFinalize (dev/test)
      redisStore.js         # Redis store — atomic Lua scripts (production)
      service.js            # generate / send / verify logic
      controller.js         # route handlers
      routes.js             # /send, /match
    email/
      service.js            # Nodemailer (smtp) or console transport
      queue.js              # QueuedEmailService (async, non-blocking)
test/
  otp.test.js               # behavior matrix (12 tests)
  concurrency.test.js       # 100-parallel send/match, race, lockout, store-failure (7 tests)
  redis.integration.test.js # Redis run w/ atomic race (skipped when Redis not available)
docker-compose.yml          # Redis 7 service
```
