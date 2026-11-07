const { createApp } = require('../src/app');

// Build the app once per serverless instance.
const app = createApp();

module.exports = async function handler(req, res) {
  return app(req, res);
};
