import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { CacheInvalidator } from '@/components/cache-invalidator';
import {
  saveTranslationReviewDraft,
  startTranslationReview,
  translationReviewStorageKey,
  translationSourceSignature,
} from '@/pages/report-translation-review';
import { setMockUser } from './mocks/clerk-react';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Translation sign-out browser regression root is missing');

const sourceText = 'Saved wording.';
const preview = [{
  id: 42,
  title: 'Moisture',
  sourceText,
  translatedText: 'Gespeicherte Übersetzung.',
}];
const sourceSignature = translationSourceSignature([{ id: 42, clientExplanation: sourceText }]);
const draftKey = translationReviewStorageKey(42, 'de');
const preferenceKey = 'sitecheck-ai-preferences';

saveTranslationReviewDraft(
  window.localStorage,
  42,
  'de',
  sourceSignature,
  startTranslationReview(preview),
);
window.localStorage.setItem(preferenceKey, '{"length":"standard"}');

createRoot(rootElement).render(
  <QueryClientProvider client={new QueryClient()}>
    <CacheInvalidator />
  </QueryClientProvider>,
);

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 25));
const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

async function run() {
  assert(window.localStorage.getItem(draftKey), 'A translation draft must be present before sign-out');

  setMockUser('user-a');
  await wait();
  setMockUser('user-a');
  await wait();
  assert(
    window.localStorage.getItem(draftKey),
    'A same-account refresh must keep the saved translation draft',
  );

  setMockUser(null);
  await wait();
  assert(
    window.localStorage.getItem(draftKey) === null,
    'The Clerk sign-out event must remove translation-review drafts',
  );
  assert(
    window.localStorage.getItem(preferenceKey) === '{"length":"standard"}',
    'Unrelated preferences must remain after sign-out cleanup',
  );
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