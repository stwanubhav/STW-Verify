function storageUnavailable(action = 'save') {
  const err = new Error(
    `Settings storage is unavailable (${action}). On Vercel, set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.`,
  );
  err.code = 'KV_UNAVAILABLE';
  err.status = 503;
  return err;
}

module.exports = { storageUnavailable };
