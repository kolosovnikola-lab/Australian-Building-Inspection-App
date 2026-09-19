import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import {
  approvedReadabilityExplanation,
  readabilityBoundaryReport,
} from './shared-report-readability.fixture.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('shared report HTML excludes readability guidance', async () => {
  const server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(root, 'src') },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });

  try {
    const { SharedReportDocument } = await server.ssrLoadModule('/src/pages/shared-report.tsx');
    const html = renderToStaticMarkup(createElement(SharedReportDocument, { report: readabilityBoundaryReport }));

    assert.match(html, new RegExp(approvedReadabilityExplanation));
    assert.doesNotMatch(html, /long_sentence|technical_term|efflorescence.*consider explaining/i);
    assert.doesNotMatch(html, /readiness|advisories|warnings|Consider splitting this into shorter sentences/i);
  } finally {
    await server.close();
  }
});