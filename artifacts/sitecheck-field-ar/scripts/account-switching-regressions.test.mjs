import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountSwitchCleanup,
  canSubmitFieldData,
  hasAccountChanged,
  queueStorageKey,
  readCurrentAccountQueue,
  removePreviousAccountQueue,
  shouldRedirectToSignIn,
} from '../lib/account-security.ts';

test('a signed-out session does not redirect until Clerk has loaded', () => {
  assert.equal(shouldRedirectToSignIn(false, false), false);
  assert.equal(shouldRedirectToSignIn(true, false), true);
  assert.equal(shouldRedirectToSignIn(true, true), false);
});

test('a user change is detected for sign-out and account replacement', () => {
  assert.equal(hasAccountChanged(undefined, null), false);
  assert.equal(hasAccountChanged('user-a', null), true);
  assert.equal(hasAccountChanged('user-a', 'user-b'), true);
  assert.equal(hasAccountChanged('user-a', 'user-a'), false);
});

test('account changes clear the inspection cache and old user queue', () => {
  assert.deepEqual(accountSwitchCleanup(undefined, 'user-a'), {
    clearInspectionCache: false,
    removeQueueKey: null,
  });
  assert.deepEqual(accountSwitchCleanup('user-a', 'user-b'), {
    clearInspectionCache: true,
    removeQueueKey: '@sitecheck_queue:user-a',
  });
  assert.deepEqual(accountSwitchCleanup('user-a', null), {
    clearInspectionCache: true,
    removeQueueKey: '@sitecheck_queue:user-a',
  });
  assert.deepEqual(accountSwitchCleanup('user-a', 'user-a'), {
    clearInspectionCache: false,
    removeQueueKey: null,
  });
});

test('queue data stays isolated under user-scoped storage keys', () => {
  assert.equal(queueStorageKey(null), null);
  assert.equal(queueStorageKey('user-a'), '@sitecheck_queue:user-a');
  assert.notEqual(queueStorageKey('user-a'), queueStorageKey('user-b'));
});

test('field submissions require both a signed-in state and a current token', () => {
  assert.equal(canSubmitFieldData(false, null), false);
  assert.equal(canSubmitFieldData(false, 'stale-token'), false);
  assert.equal(canSubmitFieldData(true, null), false);
  assert.equal(canSubmitFieldData(true, 'current-token'), true);
});

test('a restarted provider cannot load evidence from the previous account', async () => {
  const persisted = new Map();
  const storage = {
    async getItem(key) {
      return persisted.get(key) ?? null;
    },
    async removeItem(key) {
      persisted.delete(key);
    },
  };
  const userAEvidence = JSON.stringify([
    { id: 'user-a-photo', imageUri: 'file:///private/user-a-evidence.jpg' },
  ]);
  persisted.set(queueStorageKey('user-a'), userAEvidence);

  await removePreviousAccountQueue(storage, 'user-a', null);
  assert.equal(persisted.has(queueStorageKey('user-a')), false);

  // A new provider instance starts with no previous identity after the app reopens.
  await removePreviousAccountQueue(storage, null, 'user-b');
  const reopenedQueue = await readCurrentAccountQueue(storage, 'user-b');
  assert.equal(reopenedQueue, null);
  assert.doesNotMatch(JSON.stringify([...persisted.values()]), /user-a-photo|user-a-evidence/);
});

test('direct account replacement removes user A before user B is hydrated', async () => {
  const persisted = new Map([
    [queueStorageKey('user-a'), JSON.stringify([{ id: 'old-evidence' }])],
    [queueStorageKey('user-b'), JSON.stringify([{ id: 'user-b-evidence' }])],
  ]);
  const storage = {
    async getItem(key) {
      return persisted.get(key) ?? null;
    },
    async removeItem(key) {
      persisted.delete(key);
    },
  };

  await removePreviousAccountQueue(storage, 'user-a', 'user-b');
  assert.equal(persisted.has(queueStorageKey('user-a')), false);
  assert.match(await readCurrentAccountQueue(storage, 'user-b'), /user-b-evidence/);
});