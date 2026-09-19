import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allTranslationsAccepted,
  clearTranslationReviewDraftsOnAccountChange,
  clearTranslationReviewDraftsForAccount,
  discardTranslationReviewDraft,
  loadTranslationReviewDraft,
  mergeTranslationPreview,
  saveTranslationReviewDraft,
  startTranslationReview,
  translationReviewStorageKey,
  translationSourceSignature,
  type TranslationReviewItem,
} from './report-translation-review.ts';

const preview = [
  { id: 1, title: 'Crack', sourceText: 'A crack is visible.', translatedText: 'Translated crack.' },
  { id: 2, title: 'Moisture', sourceText: 'Moisture is visible.', translatedText: 'Translated moisture.' },
];

test('translation previews start unaccepted so inspectors must review them', () => {
  assert.deepEqual(startTranslationReview(preview), [
    { id: 1, title: 'Crack', sourceText: 'A crack is visible.', text: 'Translated crack.', accepted: false },
    { id: 2, title: 'Moisture', sourceText: 'Moisture is visible.', text: 'Translated moisture.', accepted: false },
  ]);
  assert.equal(allTranslationsAccepted(startTranslationReview(preview)), false);
});

test('editing a translation requires it to be accepted again', () => {
  const items = startTranslationReview(preview).map((item) => ({ ...item, accepted: true })) satisfies TranslationReviewItem[];
  const edited = items.map((item) => item.id === 1 ? { ...item, text: 'Edited wording.', accepted: false } : item);
  assert.equal(allTranslationsAccepted(edited), false);
  assert.equal(allTranslationsAccepted(edited.map((item) => item.id === 1 ? { ...item, accepted: true } : item)), true);
});

test('single-item regeneration replaces only the requested explanation', () => {
  const current = startTranslationReview(preview).map((item) => ({ ...item, accepted: true }));
  const merged = mergeTranslationPreview(current, [{ ...preview[0], translatedText: 'Regenerated crack.' }], 1);
  assert.deepEqual(merged, [
    { id: 1, title: 'Crack', sourceText: 'A crack is visible.', text: 'Regenerated crack.', accepted: false },
    { id: 2, title: 'Moisture', sourceText: 'Moisture is visible.', text: 'Translated moisture.', accepted: true },
  ]);
});

test('translation drafts survive reload and preserve accepted states', () => {
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
  };
  const items = startTranslationReview(preview).map((item) => ({ ...item, accepted: true }));
  const sourceSignature = translationSourceSignature([
    { id: 1, clientExplanation: preview[0].sourceText },
    { id: 2, clientExplanation: preview[1].sourceText },
  ]);

  saveTranslationReviewDraft(adapter, 'user-a', 42, 'zh-Hans', sourceSignature, items);

  assert.deepEqual(
    loadTranslationReviewDraft(adapter, 'user-a', 42, 'zh-Hans', sourceSignature),
    items,
  );
});

test('translation drafts are discarded when language or English wording changes', () => {
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
  };
  const sourceSignature = translationSourceSignature([{ id: 1, clientExplanation: 'Original wording.' }]);
  const items = startTranslationReview([preview[0]]);
  saveTranslationReviewDraft(adapter, 'user-a', 42, 'zh-Hans', sourceSignature, items);

  assert.deepEqual(loadTranslationReviewDraft(adapter, 'user-a', 42, 'vi', sourceSignature), []);
  discardTranslationReviewDraft(adapter, 'user-a', 42, 'zh-Hans');
  assert.equal(storage.has(translationReviewStorageKey('user-a', 42, 'zh-Hans')), false);

  saveTranslationReviewDraft(adapter, 'user-a', 42, 'zh-Hans', sourceSignature, items);
  assert.deepEqual(
    loadTranslationReviewDraft(
      adapter,
      'user-a',
      42,
      'zh-Hans',
      translationSourceSignature([{ id: 1, clientExplanation: 'Changed wording.' }]),
    ),
    [],
  );
  assert.equal(storage.has(translationReviewStorageKey('user-a', 42, 'zh-Hans')), false);
});

test('translation drafts stay isolated by account and survive normal refresh', () => {
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
  };
  const sourceSignature = translationSourceSignature([{ id: 1, clientExplanation: 'Saved wording.' }]);
  saveTranslationReviewDraft(adapter, 'user-a', 42, 'zh-Hans', sourceSignature, startTranslationReview(preview));
  saveTranslationReviewDraft(adapter, 'user-b', 43, 'vi', sourceSignature, startTranslationReview(preview));
  storage.set('sitecheck-ai-preferences', '{"length":"standard"}');

  assert.equal(clearTranslationReviewDraftsOnAccountChange(adapter, 'user-a', 'user-a'), false);
  assert.equal(storage.has(translationReviewStorageKey('user-a', 42, 'zh-Hans')), true);
  assert.deepEqual(loadTranslationReviewDraft(adapter, 'user-b', 42, 'zh-Hans', sourceSignature), []);
  assert.deepEqual(loadTranslationReviewDraft(adapter, 'user-a', 42, 'zh-Hans', sourceSignature), startTranslationReview(preview));

  assert.equal(clearTranslationReviewDraftsOnAccountChange(adapter, 'user-a', 'user-b'), true);
  assert.equal(storage.has(translationReviewStorageKey('user-a', 42, 'zh-Hans')), true);
  assert.equal(storage.has(translationReviewStorageKey('user-b', 43, 'vi')), true);
  assert.equal(storage.has('sitecheck-ai-preferences'), true);
});

test('sign-out removes only the departing account drafts and clears legacy drafts', () => {
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
  };
  const sourceSignature = translationSourceSignature([{ id: 1, clientExplanation: 'Saved wording.' }]);
  saveTranslationReviewDraft(adapter, 'user-a', 42, 'zh-Hans', sourceSignature, startTranslationReview(preview));
  saveTranslationReviewDraft(adapter, 'user-b', 43, 'vi', sourceSignature, startTranslationReview(preview));
  storage.set('sitecheck-translation-review:44:ar', JSON.stringify({ stale: true }));

  assert.equal(clearTranslationReviewDraftsOnAccountChange(adapter, 'user-a', null), true);
  assert.equal(storage.has(translationReviewStorageKey('user-a', 42, 'zh-Hans')), false);
  assert.equal(storage.has(translationReviewStorageKey('user-b', 43, 'vi')), true);
  assert.equal(storage.has('sitecheck-translation-review:44:ar'), false);
});

test('account cleanup can remove stale drafts without touching another account', () => {
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
  };
  const sourceSignature = translationSourceSignature([{ id: 1, clientExplanation: 'Saved wording.' }]);
  saveTranslationReviewDraft(adapter, 'user-a', 42, 'zh-Hans', sourceSignature, startTranslationReview(preview));
  saveTranslationReviewDraft(adapter, 'user-b', 42, 'zh-Hans', sourceSignature, startTranslationReview(preview));

  clearTranslationReviewDraftsForAccount(adapter, 'user-a');
  assert.equal(storage.has(translationReviewStorageKey('user-a', 42, 'zh-Hans')), false);
  assert.equal(storage.has(translationReviewStorageKey('user-b', 42, 'zh-Hans')), true);
});