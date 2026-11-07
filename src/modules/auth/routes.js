const express = require('express');
const { requireAuthApi } = require('../../middleware/auth');

function authRoutes() {
  const router = express.Router();

  router.get('/status', async (req, res, next) => {
    try {
      res.json({ success: true, configured: await req.app.locals.authService.isConfigured() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req, res) => {
    const auth = req.app.locals.authService;
    const { email, password } = req.body || {};
    if (await auth.verify(email, password)) {
      const token = auth.issueSession(email);
      res.cookie('stw_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: auth.sessionTtlMs,
      });
      return res.json({ success: true, email: await auth.email() });
    }
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie('stw_session', { path: '/' });
    return res.json({ success: true });
  });

  router.get('/me', requireAuthApi, (req, res) => {
    const auth = req.app.locals.authService;
    const email = auth.emailFromToken(req.cookies && req.cookies.stw_session) || auth.email();
    res.json({ success: true, email });
  });

  router.put('/credentials', requireAuthApi, async (req, res, next) => {
    try {
      const result = await req.app.locals.authService.changeCredentials(req.body || {});
      res.json({ success: true, message: 'Login credentials updated', email: result.email });
    } catch (err) {
      if (err.code) return res.status(err.status || 400).json({ success: false, message: err.message });
      return next(err);
    }
  });

  return router;
}

module.exports = { authRoutes };
