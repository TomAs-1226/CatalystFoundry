const path = require('node:path');

/** Pure launch policy shared by the Electron host and regression tests. */
function desktopPaths(appDirectory, userDirectory) {
  if (!path.isAbsolute(appDirectory) || !path.isAbsolute(userDirectory)) {
    throw new Error('Desktop application and user-data directories must be absolute.');
  }
  return {
    staticDirectory: path.join(appDirectory, 'dist'),
    serverEntry: path.join(appDirectory, 'desktop-dist', 'server.cjs'),
    dataDirectory: path.join(userDirectory, 'data'),
    logDirectory: path.join(userDirectory, 'logs'),
  };
}

function requestIsLocal(headers, expectedOrigin) {
  const expected = new URL(expectedOrigin);
  return headers.host === expected.host &&
    (!headers.origin || headers.origin === expectedOrigin);
}

function navigationIsLocal(candidate, expectedOrigin) {
  try { return new URL(candidate).origin === expectedOrigin; }
  catch { return false; }
}

function externalUrlIsAllowed(candidate) {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function smokeOptions(args) {
  const report = args.find(arg => arg.startsWith('--foundry-smoke-report='))?.slice('--foundry-smoke-report='.length);
  const data = args.find(arg => arg.startsWith('--foundry-smoke-data='))?.slice('--foundry-smoke-data='.length);
  const phase = args.find(arg => arg.startsWith('--foundry-smoke-phase='))?.slice('--foundry-smoke-phase='.length) || 'save';
  if (!report && !data) return undefined;
  if (!report || !data || !path.isAbsolute(report) || !path.isAbsolute(data)) {
    throw new Error('Smoke verification requires absolute report and isolated data paths.');
  }
  if (!['save', 'reopen'].includes(phase)) throw new Error('Unknown desktop smoke phase.');
  return { report, data, phase };
}

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; font-src 'self' data:; form-action 'self'";

const browserOptions = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false,
});

module.exports = { desktopPaths, requestIsLocal, navigationIsLocal, externalUrlIsAllowed, smokeOptions, contentSecurityPolicy, browserOptions };
