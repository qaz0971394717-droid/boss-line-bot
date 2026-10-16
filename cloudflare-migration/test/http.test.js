import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../src/http.js';

test('aborts a stalled request once without retrying', async () => {
  let calls = 0;
  let signal;
  const fetcher = async (_url, options) => {
    calls++;
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      reject(new DOMException('Timed out', 'AbortError'));
    }, { once: true }));
  };
  await assert.rejects(fetchWithTimeout('https://example.test', {}, fetcher, 10), { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test('preserves API payload and rejects credential-bearing redirects', async () => {
  const response = new Response(null, { status: 202 });
  const result = await fetchWithTimeout('https://example.test', {
    method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: '{}'
  }, async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    assert.equal(options.body, '{}');
    return response;
  });
  assert.equal(result, response);
});

test('rejects redirects without making a second credential-bearing request', async () => {
  let calls = 0;
  await assert.rejects(fetchWithTimeout('https://example.test', {headers: {Authorization: 'Bearer test-only'}}, async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, {status: 302, headers: {Location: 'https://other.test'}});
  }), /HTTP redirect rejected/);
  assert.equal(calls, 1);
});
