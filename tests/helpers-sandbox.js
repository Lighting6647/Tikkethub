/**
 * E2E sandbox: runs a copy of the app from a temp folder on a free port.
 * backend/db.js also writes <project>/data/settings.json regardless of DATA_DIR, so isolating DATA_DIR alone
 * is not enough. The copy has no data/ folder: no real orders, settings, PINs or tokens can be read or changed.
 */
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const Module = require('node:module');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['data', 'node_modules', '.git', '.vercel', '.claude', 'scripts', 'logo', 'gemini-live-agent']);
const KEEP_ENV = /^(path|pathext|systemroot|windir|temp|tmp|tmpdir|home|userprofile|appdata|localappdata|programdata|programfiles.*|lang|lc_.*|tz)$/i;

function createSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tickethub-e2e-'));
  fs.cpSync(ROOT, dir, {
    recursive: true,
    filter: (src) => {
      const top = path.relative(ROOT, src).split(path.sep)[0];
      return !SKIP.has(top) && !/^\.env/i.test(top);
    }
  });
  const modules = path.dirname(path.dirname(require.resolve('playwright-core/package.json')));
  process.env.NODE_PATH = modules;
  Module._initPaths();
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir);
  const env = { DATA_DIR: dataDir, NODE_PATH: modules };
  for (const [k, v] of Object.entries(process.env)) if (KEEP_ENV.test(k)) env[k] = v;
  return {
    dir,
    dataDir,
    env,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {}
    }
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

module.exports = { createSandbox, freePort };
