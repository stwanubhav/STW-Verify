const express = require('express');
const { handleSend, handleMatch } = require('./controller');
const { sendIpLimiter, sendEmailLimiter, matchLimiter } = require('../../middleware/rateLimit');

function otpRoutes(config) {
  const router = express.Router();

  router.post('/send', sendIpLimiter(config), sendEmailLimiter(config), handleSend);
  router.post('/match', matchLimiter(config), handleMatch);

  return router;
}

module.exports = { otpRoutes };
