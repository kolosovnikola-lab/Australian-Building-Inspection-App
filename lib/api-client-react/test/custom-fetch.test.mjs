import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customFetch,
  setAuthTokenGetter,
} from '../src/custom-fetch.ts';

const originalFetch = globalThis.fetch;

function jsonResponse(body = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  setAuthTokenGetter(null);
});

test('signed-out requests do not receive an authorization header', async () => {
  let requestHeaders;
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return jsonResponse();
  };
  setAuthTokenGetter(null);

  await customFetch('/api/inspections', { responseType: 'json' });

  assert.equal(requestHeaders.get('authorization'), null);
});

test('token replacement is used on the next request without retaining the old token', async () => {
  const authorizationHeaders = [];
  globalThis.fetch = async (_input, init) => {
    authorizationHeaders.push(new Headers(init?.headers).get('authorization'));
    return jsonResponse();
  };

  let token = 'token-a';
  setAuthTokenGetter(() => token);
  await customFetch('/api/inspections', { responseType: 'json' });

  token = 'token-b';
  await customFetch('/api/inspections', { responseType: 'json' });

  assert.deepEqual(authorizationHeaders, ['Bearer token-a', 'Bearer token-b']);
});