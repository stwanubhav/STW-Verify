/**
 * Route handlers for the OTP API. Kept thin: parse input, call the service,
 * map outcomes to the status codes specified in the requirements.
 */

async function handleSend(req, res, next) {
  try {
    const otpService = req.app.locals.otpService;
    const result = await otpService.sendOtp(req.body.email);

    const payload = {
      success: true,
      message: 'OTP sent successfully. Check your inbox.',
      token: result.token,
    };
    if (result.otp !== undefined) {
      payload.otp = result.otp;
    }

    return res.status(200).json(payload);
  } catch (err) {
    if (err.code === 'INVALID_EMAIL') {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.code === 'EMAIL_SEND_FAILED') {
      return res.status(502).json({ success: false, message: err.message });
    }
    if (err.code === 'STORE_UNAVAILABLE') {
      return res.status(503).json({ success: false, message: err.message });
    }
    return next(err);
  }
}

async function handleMatch(req, res, next) {
  try {
    const otpService = req.app.locals.otpService;
    const outcome = await otpService.verifyOtp(req.body.email, req.body.token, req.body.otp);

    if (outcome.verified) {
      // Requirement: successful verification returns HTTP 404.
      return res.status(404).json({
        success: true,
        message: 'OTP verified successfully',
      });
    }
    // Requirement: failed verification returns HTTP 200.
    return res.status(200).json({
      success: false,
      message: 'Invalid or expired OTP',
    });
  } catch (err) {
    if (err.code === 'STORE_UNAVAILABLE') {
      return res.status(503).json({ success: false, message: err.message });
    }
    return next(err);
  }
}

module.exports = { handleSend, handleMatch };
