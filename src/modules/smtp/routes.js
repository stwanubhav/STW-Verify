const express = require('express');

async function handleStatus(req, res, next) {
  try {
    res.json(await req.app.locals.smtpCredentials.public());
  } catch (err) {
    next(err);
  }
}

async function handleUpdate(req, res, next) {
  try {
    const result = await req.app.locals.smtpCredentials.save(req.body || {});
    res.json({ success: true, message: 'SMTP credentials updated', emailUser: result.emailUser });
  } catch (err) {
    if (err.code === 'INVALID_SMTP') {
      return res.status(400).json({ success: false, message: err.message });
    }
    return next(err);
  }
}

function smtpRoutes() {
  const router = express.Router();
  router.get('/status', handleStatus);
  router.put('/', handleUpdate);
  return router;
}

module.exports = { smtpRoutes };
