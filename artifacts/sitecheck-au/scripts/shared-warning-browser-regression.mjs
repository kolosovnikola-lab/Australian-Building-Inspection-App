import { spawn } from 'node:child_process';
import net from 'node:net';

const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const address = probe.address();
const port = typeof address === 'object' && address ? address.port : 0;
await new Promise((resolve) => probe.close(resolve));
const {
  REPL_ID: _replId,
  REPLIT_DEV_DOMAIN: _replitDevDomain,
  REPLIT_DOMAINS: _replitDomains,
  ...isolatedEnv
} = process.env;
const testPath = process.argv[2] ?? "/browser-tests/shared-warning.html";
const testName = process.argv[3] ?? "Shared warning";

const server = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...isolatedEnv,
    PORT: String(port),
    BASE_PATH: '/',
    NODE_ENV: 'test',
    ...(testPath.includes('/glossary.html') ? { GLOSSARY_BROWSER_TEST: '1' } : {}),
    ...(testPath.includes('/translation-signout.html') ? { TRANSLATION_BROWSER_TEST: '1' } : {}),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk; });
server.stderr.on('data', (chunk) => { serverOutput += chunk; });

try {
  const url = `http://127.0.0.1:${port}${testPath}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error(`Browser test Vite server did not start.\n${serverOutput}`);

  const chromium = spawn('/repl/tools/bin/chromium', [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--virtual-time-budget=5000',
    '--dump-dom',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let output = '';
  chromium.stdout.on('data', (chunk) => { output += chunk; });
  chromium.stderr.on('data', (chunk) => { output += chunk; });
  const exitCode = await new Promise((resolve) => chromium.on('exit', (code) => resolve(code ?? 1)));
  if (exitCode !== 0 || !output.includes('data-test-result="pass"')) {
    throw new Error(`${testName} browser regression failed.\n${output.slice(-5000)}`);
  }
  console.log(`${testName} browser regression passed in Chromium.`);
} finally {
  server.kill('SIGTERM');
}