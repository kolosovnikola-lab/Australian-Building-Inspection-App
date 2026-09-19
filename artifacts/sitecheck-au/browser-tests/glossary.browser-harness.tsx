import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ClientLanguageGlossaryPage } from '@/pages/client-language-glossary';
import { SiteShell } from '@/components/site-shell';
import { setMockRole } from './mocks/clerk-react';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Glossary browser regression root is missing');
createRoot(rootElement).render(
  <QueryClientProvider client={new QueryClient()}>
    <SiteShell>
      <ClientLanguageGlossaryPage />
    </SiteShell>
  </QueryClientProvider>,
);

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 25));
const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};
const byLabel = <T extends HTMLInputElement>(label: string) => {
  const element = document.querySelector<T>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing input: ${label}`);
  return element;
};
const setInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const buttonNamed = (name: string, within: ParentNode = document) => {
  const button = [...within.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim().includes(name));
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
};
const termRow = (term: string) => {
  const heading = [...document.querySelectorAll('p')].find((candidate) => candidate.textContent === term);
  const row = heading?.closest<HTMLDivElement>('.rounded-md.border');
  if (!row) throw new Error(`Missing glossary row: ${term}`);
  return row;
};

async function run() {
  await wait();
  assert(document.body.textContent?.includes('efflorescence'), 'Manager must see seeded glossary terms');
  assert(document.querySelector('[data-testid="link-nav-client-language"]'), 'Manager must see Client language navigation');

  setInput(byLabel('New glossary term'), 'spalling');
  setInput(byLabel('Suggested plain-language meaning'), 'surface material breaking away');
  await wait();
  buttonNamed('Add term').click();
  await wait();
  assert(document.body.textContent?.includes('spalling'), 'Added term must appear in the visible list');

  buttonNamed('Edit', termRow('spalling')).click();
  await wait();
  const editTerm = byLabel('Edit term spalling');
  setInput(editTerm, 'concrete spalling');
  await wait();
  buttonNamed('Save').click();
  await wait();
  assert(document.body.textContent?.includes('concrete spalling'), 'Edited term must update in the visible list');

  const editedRow = termRow('concrete spalling');
  buttonNamed('Retire', editedRow).click();
  await wait();
  assert(termRow('concrete spalling').textContent?.includes('Retired'), 'Retired status must be visible');
  buttonNamed('Restore', termRow('concrete spalling')).click();
  await wait();
  assert(termRow('concrete spalling').textContent?.includes('Active'), 'Restored status must be visible');
  const history = document.querySelector('[data-testid="glossary-change-history"]');
  assert(history?.textContent?.includes('Test Manager added'), 'History must show who added a term');
  assert(history?.textContent?.includes('Test Manager edited'), 'History must show edits');
  assert(history?.textContent?.includes('Test Manager retired'), 'History must show retirements');
  assert(history?.textContent?.includes('Test Manager restored'), 'History must show restorations');

  setMockRole('inspector');
  await wait();
  assert(!document.querySelector('[data-testid="link-nav-client-language"]'), 'Non-manager navigation must hide Client language');
  assert(document.body.textContent?.includes('Manager access required'), 'Non-manager must receive the access-safe page state');
}

void (async () => {
  const result = document.getElementById('result');
  try {
    await run();
    document.body.dataset.testResult = 'pass';
    if (result) result.textContent = 'PASS';
  } catch (error) {
    document.body.dataset.testResult = 'fail';
    if (result) result.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  }
})();