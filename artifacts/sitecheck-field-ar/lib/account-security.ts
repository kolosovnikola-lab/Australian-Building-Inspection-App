export const QUEUE_STORAGE_KEY = '@sitecheck_queue';

export interface QueueStorageReader {
  getItem: (key: string) => Promise<string | null>;
}

export interface QueueStorageCleaner {
  removeItem: (key: string) => Promise<void>;
}

export function queueStorageKey(userId: string | null | undefined): string | null {
  return userId ? `${QUEUE_STORAGE_KEY}:${userId}` : null;
}

export function hasAccountChanged(
  previousUserId: string | null | undefined,
  nextUserId: string | null | undefined,
): boolean {
  return previousUserId !== undefined && previousUserId !== nextUserId;
}

export function accountSwitchCleanup(
  previousUserId: string | null | undefined,
  nextUserId: string | null | undefined,
): {
  clearInspectionCache: boolean;
  removeQueueKey: string | null;
} {
  const changed = hasAccountChanged(previousUserId, nextUserId);
  return {
    clearInspectionCache: changed,
    removeQueueKey: changed ? queueStorageKey(previousUserId) : null,
  };
}

export async function removePreviousAccountQueue(
  storage: QueueStorageCleaner,
  previousUserId: string | null | undefined,
  nextUserId: string | null | undefined,
) {
  const previousKey = accountSwitchCleanup(previousUserId, nextUserId).removeQueueKey;
  const nextKey = queueStorageKey(nextUserId);
  if (previousKey && previousKey !== nextKey) {
    await storage.removeItem(previousKey);
  }
}

export async function readCurrentAccountQueue(
  storage: QueueStorageReader,
  userId: string | null | undefined,
) {
  const key = queueStorageKey(userId);
  return key ? storage.getItem(key) : null;
}

export function shouldRedirectToSignIn(isLoaded: boolean, isSignedIn: boolean): boolean {
  return isLoaded && !isSignedIn;
}

export function canSubmitFieldData(
  isSignedIn: boolean,
  token: string | null | undefined,
): boolean {
  return isSignedIn && Boolean(token);
}