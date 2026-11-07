/* eslint-disable no-console */
function info(...args) {
  console.log(new Date().toISOString(), '[info]', ...args);
}

function warn(...args) {
  console.warn(new Date().toISOString(), '[warn]', ...args);
}

function error(...args) {
  console.error(new Date().toISOString(), '[error]', ...args);
}

module.exports = { info, warn, error };
