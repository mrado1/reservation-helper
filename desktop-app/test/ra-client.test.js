const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { requestInPage, createRaClient } = require('../lib/ra-client');
function page({ status = 200, cookie = 'a1Data=%7B%7D; ra2Refresh=dummy', sdk = true } = {}) {
  let refreshes = 0, calls = 0;
  const context = vm.createContext({ location: { origin: 'https://www.reserveamerica.com' }, document: { cookie, querySelector: () => ({ content: 'test-csrf' }) }, AbortController, DOMException, setTimeout, clearTimeout, atob,
    fetch: async () => { refreshes++; return { ok: true, json: async () => ({ idToken: 'dummy', a1Data: {}, refreshToken: 'dummy' }) }; },
    ...(sdk ? { AwsWafIntegration: { fetch: async () => { calls++; return { ok: status === 200, status, text: async () => JSON.stringify({ contractViewList: [] }), headers: { get: () => null } }; } } } : {}) });
  return { run: request => vm.runInContext(`(${requestInPage})(${JSON.stringify({ id: 'test:1', method: 'GET', path: '', timeoutMs: 1000, ...request })})`, context), refreshes: () => refreshes, calls: () => calls };
}
test('browser transport refreshes auth and uses the website SDK without returning credentials', async () => {
  const p = page(); const result = await p.run({}); assert.equal(result.ok, true); assert.equal(result.status, 200); assert.equal(p.refreshes(), 1); assert.equal(p.calls(), 1); assert.ok(!JSON.stringify(result).includes('dummy'));
  await p.run({ id: 'test:2' }); assert.equal(p.refreshes(), 1);
});
test('405 is browser verification, not invalid credentials', async () => { const result = await page({ status: 405 }).run({}); assert.equal(result.reason, 'verification_required'); });
test('missing sign-in session does not submit requests', async () => { const p = page({ cookie: '' }); assert.equal((await p.run({})).reason, 'signed_out'); assert.equal(p.calls(), 0); });
test('unavailable browser SDK pauses for verification instead of bypassing it', async () => { const p = page({ sdk: false }); assert.equal((await p.run({})).reason, 'verification_required'); assert.equal(p.calls(), 0); });
test('request cancellation returns promptly even if page evaluation hangs', async () => {
  const controller = new AbortController(); let cancellations = 0;
  const client = createRaClient(() => ({ isDestroyed: () => false, getURL: () => 'https://www.reserveamerica.com/', mainFrame: { executeJavaScript: expression => { if (expression.includes('"cancel":')) { cancellations++; return Promise.resolve({ ok: true }); } return new Promise(() => {}); } } }));
  const result = client.cart({ signal: controller.signal }); controller.abort(); assert.equal((await result).reason, 'cancelled'); assert.equal(cancellations, 1);
});
test('outer request deadline reports timeout rather than cancellation', async () => {
  const client = createRaClient(() => ({ isDestroyed: () => false, getURL: () => 'https://www.reserveamerica.com/', mainFrame: { executeJavaScript: () => new Promise(() => {}) } }), { timeoutMs: 1 });
  assert.equal((await client.cart()).reason, 'timeout');
});
test('requests execute on mainFrame even when WebContents is still loading', async () => {
  let frameCalls = 0;
  const client = createRaClient(() => ({ isDestroyed: () => false, getURL: () => 'https://www.reserveamerica.com/', executeJavaScript: () => { throw Error('must not wait for page load'); }, mainFrame: { executeJavaScript: async () => { frameCalls++; return { ok: true, status: 200, body: { contractViewList: [] } }; } } }));
  assert.equal((await client.cart()).status, 200); assert.equal(frameCalls, 1);
});
