function notFound(req, res) {
  res.status(404).json({ success: false, message: 'Route not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({
    success: false,
    message: status === 500 ? 'Internal server error' : err.message,
  });
}

module.exports = { notFound, errorHandler };
