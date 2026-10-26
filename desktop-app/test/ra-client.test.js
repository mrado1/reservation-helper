const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { requestInPage, createRaClient } = require('../lib/ra-client');
function testDocument(initial) {
  const cookies = new Map(initial.split(';').map(part => part.trim().split(/=(.*)/s).slice(0, 2)));
  return { get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); }, set cookie(value) { const [key, val] = value.split(';')[0].split(/=(.*)/s); cookies.set(key, val); }, querySelector: () => ({ content: 'test-csrf' }) };
}
function page({ status = 200, cookie = 'a1Data=%7B%7D; ra2Refresh=dummy', sdk = true } = {}) {
  let refreshes = 0, calls = 0;
  const context = vm.createContext({ location: { origin: 'https://www.reserveamerica.com' }, document: testDocument(cookie), AbortController, DOMException, setTimeout, clearTimeout, atob,
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

function preparedPage({ directStatus = 200, throwDirect = false, token = true } = {}) {
  let refreshes = 0, tokens = 0, direct = 0, sdkCalls = 0;
  const response = status => ({ ok: status === 200, status, clone: () => ({ json: async () => ({ contractViewList: [] }) }), text: async () => JSON.stringify({ contractViewList: [] }), headers: { get: () => null } });
  const context = vm.createContext({ location: { origin: 'https://www.reserveamerica.com' }, document: testDocument('a1Data=%7B%7D; ra2Refresh=dummy'), AbortController, DOMException, setTimeout, clearTimeout, atob,
    fetch: async (url, options) => {
      if (url === '/refreshAuth') { refreshes++; return { ok: true, json: async () => ({ idToken: 'private-auth', a1Data: {} }) }; }
      direct++; assert.equal(options.headers['x-aws-waf-token'], 'private-waf');
      if (throwDirect) throw Error('CORS');
      return response(directStatus);
    },
    AwsWafIntegration: { getToken: async () => { tokens++; return token ? 'private-waf' : null; }, fetch: async () => { sdkCalls++; return response(200); } }
  });
  return { context, counts: () => ({ refreshes, tokens, direct, sdkCalls }), run: request => vm.runInContext(`(${requestInPage})(${JSON.stringify({ id: 'prepared:1', method: 'GET', path: '', timeoutMs: 1000, ...request })})`, context) };
}
test('prepares direct transport once then 100 prepared requests avoid auth/token work', async () => {
  const p = preparedPage(); const result = await p.run({ prepare: true, refresh: true });
  assert.equal(result.timing.transport, 'direct');
  assert.ok(!JSON.stringify(result).includes('private-'));
  const replies = await Promise.all(Array.from({ length: 100 }, (_, n) => p.run({ id: `burst:${n}`, method: 'POST', path: '/additem', prepared: true, body: {} })));
  assert.ok(replies.every(r => r.ok));
  assert.deepEqual(p.counts(), { refreshes: 1, tokens: 1, direct: 101, sdkCalls: 0 });
});
test('unsupported direct GET falls back during preparation, not during POSTs', async () => {
  const p = preparedPage({ throwDirect: true });
  assert.equal((await p.run({ prepare: true })).timing.transport, 'sdk');
  await p.run({ method: 'POST', path: '/additem', prepared: true });
  assert.deepEqual(p.counts(), { refreshes: 1, tokens: 1, direct: 1, sdkCalls: 2 });
});
test('rate-limited preparation does not switch transports or mark itself ready', async () => {
  const p = preparedPage({ directStatus: 429 });
  assert.equal((await p.run({ prepare: true })).status, 429);
  assert.equal((await p.run({ method: 'POST', path: '/additem', prepared: true })).reason, 'preparation_failed');
  assert.equal(p.counts().sdkCalls, 0);
});
test('expired preparation never performs token/auth work on the burst path', async () => {
  const p = preparedPage(); await p.run({ prepare: true });
  vm.runInContext('globalThis.__reservationHelperRequests.preparedUntil=0', p.context);
  assert.equal((await p.run({ prepared: true, method: 'POST', path: '/additem' })).reason, 'preparation_failed');
  assert.deepEqual(p.counts(), { refreshes: 1, tokens: 1, direct: 1, sdkCalls: 0 });
});
test('preparation requires a valid verification token', async () => {
  const p = preparedPage({ token: false });
  assert.equal((await p.run({ prepare: true })).reason, 'verification_required');
  assert.equal(p.counts().direct, 0);
});
