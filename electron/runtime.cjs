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
  const bundled=args.includes('--foundry-smoke-bundled');
  if (!report && !data&&!bundled) return undefined;
  if (!report || !data || !path.isAbsolute(report) || !path.isAbsolute(data)) {
    throw new Error('Smoke verification requires absolute report and isolated data paths.');
  }
  if (!['save', 'reopen'].includes(phase)) throw new Error('Unknown desktop smoke phase.');
  return { report, data, phase,...(bundled?{bundled:true}:{}) };
}

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; font-src 'self' data:; form-action 'self'";

function demoOptions(args){
 const data=args.find(arg=>arg.startsWith('--foundry-demo-data='))?.slice('--foundry-demo-data='.length);
 if(data===undefined)return undefined;
 if(!path.isAbsolute(data)||!/^Foundry-demo-[a-zA-Z0-9-]+$/.test(path.basename(data))||args.some(arg=>arg.startsWith('--foundry-smoke-')))throw Error('Demo mode requires a dedicated absolute Foundry-demo-* profile and cannot mix smoke flags.');
 return{data};
}

const browserOptions = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false,
});

// The current updater executes a Windows NSIS installer; never expose it on Mac.
function nativeWindowsIntegration(platform=process.platform,arch=process.arch){return platform==='win32'&&arch==='x64';}
module.exports = { desktopPaths, requestIsLocal, navigationIsLocal, externalUrlIsAllowed, smokeOptions,demoOptions, contentSecurityPolicy, browserOptions, nativeWindowsIntegration };
