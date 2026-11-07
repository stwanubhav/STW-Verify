function tokenFrom(req) {
  return req.cookies && req.cookies.stw_session;
}

function requireAuthApi(req, res, next) {
  const auth = req.app.locals.authService;
  if (auth.isValid(tokenFrom(req))) return next();
  return res.status(401).json({ success: false, message: 'Unauthorized' });
}

function requireAuthPage(req, res, next) {
  const auth = req.app.locals.authService;
  if (auth.isValid(tokenFrom(req))) return next();
  return res.redirect('/login');
}

module.exports = { requireAuthApi, requireAuthPage };
