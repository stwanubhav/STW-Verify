const express = require('express');

async function handleGetTemplate(req, res, next) {
  try {
    res.json(await req.app.locals.templateService.load());
  } catch (err) {
    next(err);
  }
}

async function handlePutTemplate(req, res, next) {
  try {
    const saved = await req.app.locals.templateService.save(req.body);
    res.json({ success: true, template: saved });
  } catch (err) {
    if (err.code === 'INVALID_TEMPLATE') {
      return res.status(400).json({ success: false, message: err.message });
    }
    return next(err);
  }
}

async function handleResetTemplate(req, res, next) {
  try {
    const t = await req.app.locals.templateService.reset();
    res.json({ success: true, template: t });
  } catch (err) {
    next(err);
  }
}

function templateRoutes() {
  const router = express.Router();
  router.get('/', handleGetTemplate);
  router.put('/', handlePutTemplate);
  router.post('/reset', handleResetTemplate);
  return router;
}

module.exports = { templateRoutes };
