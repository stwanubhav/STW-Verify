const rateLimit = require('express-rate-limit');
const { normalizeEmail } = require('../modules/otp/service');

function jsonMessage(message) {
  return { success: false, message };
}

function sendIpLimiter(config) {
  return rateLimit({
    windowMs: config.limitSendIpWindowMs,
    limit: config.limitSendIpMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: jsonMessage('Too many OTP requests from this IP. Try again later.'),
  });
}

function sendEmailLimiter(config) {
  return rateLimit({
    windowMs: config.limitSendEmailWindowMs,
    limit: config.limitSendEmailMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body && req.body.email)}`,
    message: jsonMessage('Too many OTP requests for this email. Try again later.'),
  });
}

function matchLimiter(config) {
  return rateLimit({
    windowMs: config.limitMatchWindowMs,
    limit: config.limitMatchMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body && req.body.email)}`,
    message: jsonMessage('Too many verification attempts. Try again later.'),
  });
}

module.exports = { sendIpLimiter, sendEmailLimiter, matchLimiter };
