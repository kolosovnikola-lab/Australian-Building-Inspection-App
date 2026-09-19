import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

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
const outputDir = await mkdtemp(path.join(os.tmpdir(), 'sitecheck-pdf-regression-'));
const pdfPath = path.join(outputDir, 'client-report.pdf');

const server = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...isolatedEnv,
    PORT: String(port),
    BASE_PATH: '/',
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk; });
server.stderr.on('data', (chunk) => { serverOutput += chunk; });

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(output)));
});

try {
  const url = `http://127.0.0.1:${port}/browser-tests/shared-report-pdf.html`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error(`PDF regression Vite server did not start.\n${serverOutput}`);

  const chromiumFlags = [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=3000',
  ];
  const renderedDom = await run('/repl/tools/bin/chromium', [
    ...chromiumFlags,
    '--dump-dom',
    url,
  ]);
  if (
    !renderedDom.includes('data-test-result="pass"')
    || !renderedDom.includes('data-pdf-flow-requested="true"')
  ) {
    throw new Error(`The client Create PDF control did not invoke the print flow.\n${renderedDom.slice(-5000)}`);
  }

  const browserOutput = await run('/repl/tools/bin/chromium', [
    ...chromiumFlags,
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    url,
  ]);
  const pdf = await readFile(pdfPath);
  if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) {
    throw new Error(`Chromium did not create a valid PDF.\n${browserOutput}`);
  }

  const extracted = String(await run('pdftotext', [pdfPath, '-']));
  const normalized = extracted.replace(/\s+/g, ' ').trim();
  const approvedExplanation = 'Efflorescence is visible on the substrate after moisture ingress.';
  if (!normalized.includes(approvedExplanation)) {
    throw new Error(`PDF omitted the inspector-approved explanation.\n${normalized}`);
  }
  const forbidden = [
    'long_sentence',
    'technical_term',
    'Consider splitting this into shorter sentences.',
    'Consider explaining “efflorescence”.',
    'readiness object inspector only',
    'tracked term metadata inspector only',
    'advisories',
    'warnings',
  ];
  const leaked = forbidden.filter((value) => normalized.toLowerCase().includes(value.toLowerCase()));
  if (leaked.length) {
    throw new Error(`PDF exposed inspector-only guidance: ${leaked.join(', ')}`);
  }
  console.log('Shared report PDF privacy regression passed in Chromium.');
} finally {
  server.kill('SIGTERM');
  await rm(outputDir, { recursive: true, force: true });
}