export type TranslationPreviewItem = {
  id: number;
  title: string;
  sourceText: string;
  translatedText: string;
};

export type TranslationReviewItem = {
  id: number;
  title: string;
  sourceText: string;
  text: string;
  accepted: boolean;
};

export type TranslationReviewDraft = {
  inspectionId: number;
  summaryLanguage: string;
  sourceSignature: string;
  items: TranslationReviewItem[];
};

export type TranslationReviewStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  length?: number;
  key?: (index: number) => string | null;
};

const translationReviewStoragePrefix = 'sitecheck-translation-review:v2:';
const legacyTranslationReviewStoragePrefix = 'sitecheck-translation-review:';

function accountStoragePrefix(userId: string) {
  return `${translationReviewStoragePrefix}${encodeURIComponent(userId)}:`;
}

export function translationReviewStorageKey(userId: string, inspectionId: number, summaryLanguage: string) {
  return `${accountStoragePrefix(userId)}${inspectionId}:${encodeURIComponent(summaryLanguage)}`;
}

function storageKeysWithPrefix(storage: TranslationReviewStorage, prefix: string) {
  const keys = Array.from({ length: storage.length ?? 0 }, (_, index) => storage.key?.(index) ?? null)
    .filter((key): key is string => key?.startsWith(prefix) === true);
  return keys;
}

function legacyStorageKeys(storage: TranslationReviewStorage) {
  return storageKeysWithPrefix(storage, legacyTranslationReviewStoragePrefix)
    .filter((key) => !key.startsWith(translationReviewStoragePrefix));
}

export function clearTranslationReviewDrafts(storage: TranslationReviewStorage) {
  storageKeysWithPrefix(storage, translationReviewStoragePrefix)
    .concat(legacyStorageKeys(storage))
    .forEach((key) => storage.removeItem(key));
}

export function clearTranslationReviewDraftsForAccount(
  storage: TranslationReviewStorage,
  userId: string,
) {
  storageKeysWithPrefix(storage, accountStoragePrefix(userId))
    .forEach((key) => storage.removeItem(key));
}

export function clearTranslationReviewDraftsOnAccountChange(
  storage: TranslationReviewStorage,
  previousUserId: string | null | undefined,
  nextUserId: string | null,
) {
  if (previousUserId === undefined || previousUserId === nextUserId) return false;
  if (nextUserId === null && previousUserId) {
    clearTranslationReviewDraftsForAccount(storage, previousUserId);
  }
  legacyStorageKeys(storage)
    .forEach((key) => storage.removeItem(key));
  return true;
}

export function discardTranslationReviewDraft(
  storage: TranslationReviewStorage,
  userId: string,
  inspectionId: number,
  summaryLanguage: string,
) {
  storage.removeItem(translationReviewStorageKey(userId, inspectionId, summaryLanguage));
}

export function translationSourceSignature(
  findings: Array<{ id: number; clientExplanation?: string | null }>,
) {
  return JSON.stringify(
    findings.map(({ id, clientExplanation }) => [id, clientExplanation?.trim() ?? null]),
  );
}

export function loadTranslationReviewDraft(
  storage: TranslationReviewStorage,
  userId: string,
  inspectionId: number,
  summaryLanguage: string,
  sourceSignature: string,
): TranslationReviewItem[] {
  const key = translationReviewStorageKey(userId, inspectionId, summaryLanguage);
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const draft = JSON.parse(raw) as Partial<TranslationReviewDraft>;
    const valid = draft.inspectionId === inspectionId
      && draft.summaryLanguage === summaryLanguage
      && draft.sourceSignature === sourceSignature
      && Array.isArray(draft.items)
      && draft.items.every((item) =>
        item
        && typeof item.id === 'number'
        && typeof item.title === 'string'
        && typeof item.sourceText === 'string'
        && typeof item.text === 'string'
        && typeof item.accepted === 'boolean',
      );
    if (!valid) {
      storage.removeItem(key);
      return [];
    }
    return draft.items as TranslationReviewItem[];
  } catch {
    storage.removeItem(key);
    return [];
  }
}

export function saveTranslationReviewDraft(
  storage: TranslationReviewStorage,
  userId: string,
  inspectionId: number,
  summaryLanguage: string,
  sourceSignature: string,
  items: TranslationReviewItem[],
) {
  const key = translationReviewStorageKey(userId, inspectionId, summaryLanguage);
  if (summaryLanguage === 'en' || items.length === 0) {
    discardTranslationReviewDraft(storage, userId, inspectionId, summaryLanguage);
    return;
  }
  storage.setItem(key, JSON.stringify({
    inspectionId,
    summaryLanguage,
    sourceSignature,
    items,
  } satisfies TranslationReviewDraft));
}

export function startTranslationReview(items: TranslationPreviewItem[]): TranslationReviewItem[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    sourceText: item.sourceText,
    text: item.translatedText,
    accepted: false,
  }));
}

export function mergeTranslationPreview(
  current: TranslationReviewItem[],
  incoming: TranslationPreviewItem[],
  findingId?: number,
): TranslationReviewItem[] {
  const next = startTranslationReview(incoming);
  if (findingId === undefined) return next;
  const replacement = next.find((item) => item.id === findingId);
  if (!replacement) return current;
  if (!current.some((item) => item.id === replacement.id)) return [...current, replacement];
  return current.map((item) => item.id === replacement.id ? replacement : item);
}

export function allTranslationsAccepted(items: TranslationReviewItem[]) {
  return items.length > 0 && items.every((item) => item.accepted && item.text.trim().length > 0);
}