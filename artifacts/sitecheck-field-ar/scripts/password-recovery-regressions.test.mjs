import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  passwordRecoverySignInRoute,
  recoveryStepAfterCodeVerification,
  recoveryStepAfterPasswordSubmission,
  resetPasswordRecoveryState,
} from '../lib/password-recovery.ts';

const appConfig = JSON.parse(
  await readFile(new URL('../app.json', import.meta.url), 'utf8'),
);

test('invalid and expired codes keep the inspector in the same recovery context', () => {
  assert.equal(
    recoveryStepAfterCodeVerification('code', 'needs_new_password', 'That code is invalid.'),
    'code',
  );
  assert.equal(
    recoveryStepAfterCodeVerification('code', null, 'That code has expired. Send a new code.'),
    'code',
  );
});

test('successful recovery advances through code, password, completion, and reset states', () => {
  const passwordStep = recoveryStepAfterCodeVerification('code', 'needs_new_password');
  assert.equal(passwordStep, 'password');
  const completeStep = recoveryStepAfterPasswordSubmission(passwordStep, 'complete');
  assert.equal(completeStep, 'complete');
  assert.deepEqual(resetPasswordRecoveryState(), {
    step: null,
    code: '',
    newPassword: '',
    error: null,
    notice: null,
  });
});

test('native recovery uses the configured scheme while Expo web uses its sign-in route', () => {
  assert.equal(appConfig.expo.scheme, 'sitecheck-field-ar');
  assert.equal(
    passwordRecoverySignInRoute('native', appConfig.expo.scheme),
    'sitecheck-field-ar:///sign-in',
  );
  assert.equal(
    passwordRecoverySignInRoute('web', appConfig.expo.scheme),
    '/sign-in',
  );
});