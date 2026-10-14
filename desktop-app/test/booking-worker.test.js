const test = require('node:test');
const assert = require('node:assert/strict');
const { BookingWorker, findCartItem, classify } = require('../lib/booking-worker');
const booking = { facilityId: '140', siteId: '245719', contractCode: 'NY', startDate: '2027-05-18', nights: 2, mode: 'add', openingTimezone: 'America/New_York' };
const empty = { ok: true, status: 200, body: { itemsCount: 0, contractViewList: [] } };
function cart(change = {}) { return { ok: true, status: 200, body: { itemsCount: 1, contractViewList: [{ contractCode: 'NY', cartOrderViews: [{ parkId: 140, contractCode: 'NY', webOrder: { site: { id: 245719 }, arrivalDate: '2027-05-18', units: 2, ...change } }] }] } }; }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
class Clock {
  constructor() { this.time = Date.parse('2026-10-13T12:00:00Z'); this.seq = 0; this.tasks = new Map(); }
  setTimeout = (f, ms) => { const id = ++this.seq; this.tasks.set(id, { f, at: this.time + ms }); return id; };
  clearTimeout = id => this.tasks.delete(id);
  async advance(ms) { const target = this.time + ms; await flush(); for (;;) { const next = [...this.tasks.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; this.time = next[1].at; this.tasks.delete(next[0]); next[1].f(); await flush(); } this.time = target; await flush(); }
}
function setup(overrides = {}) {
  const clock = new Clock(), statuses = [], posts = []; let successes = 0, awake = 0;
  const worker = new BookingWorker({ client: { cart: async () => empty, add: async (...args) => { posts.push(args); return cart(); }, ...overrides }, onStatus: s => statuses.push(s), onSuccess: () => successes++, keepAwake: () => { awake++; return () => awake--; }, now: () => clock.time, timers: clock });
  return { worker, clock, statuses, posts, successes: () => successes, awake: () => awake };
}
test('available campsite adds once and hands off to checkout', async () => {
  const h = setup(); assert.equal((await h.worker.start(booking)).ok, true); await flush();
  assert.equal(h.posts.length, 1); assert.equal(h.successes(), 1); assert.equal(h.worker.status.state, 'success'); assert.equal(h.awake(), 0); assert.equal(h.posts[0][0].units, 2);
});
test('today schedule refreshes session but never POSTs before opening', async () => {
  let checks = 0; const h = setup({ cart: async () => { checks++; return empty; } });
  await h.worker.start({ ...booking, mode: 'queue', unlockAtMs: h.clock.time + 8 * 3600000 }); await h.clock.advance(8 * 3600000 - 1);
  assert.equal(h.posts.length, 0); assert.equal(h.worker.status.state, 'scheduled'); assert.ok(checks > 90); assert.equal(h.awake(), 1);
  await h.clock.advance(1); assert.equal(h.posts.length, 1); assert.equal(h.worker.status.state, 'success'); assert.equal(h.awake(), 0);
});
test('cancelled schedule cannot fire at old opening time', async () => {
  const h = setup(); await h.worker.start({ ...booking, mode: 'queue', unlockAtMs: h.clock.time + 60000 }); await flush(); h.worker.stop(); await h.clock.advance(120000);
  assert.equal(h.posts.length, 0); assert.equal(h.worker.status.state, 'stopped'); assert.equal(h.awake(), 0);
});
test('late result from a stopped run cannot affect a new run', async () => {
  let resolve, signal; const h = setup({ add: (_, o) => { signal = o.signal; return new Promise(r => resolve = r); } });
  await h.worker.start(booking); await flush(); h.worker.stop(); assert.ok(signal.aborted);
  await h.worker.start({ ...booking, mode: 'queue', unlockAtMs: h.clock.time + 60000 }); await flush(); resolve(cart()); await flush();
  assert.equal(h.worker.status.state, 'scheduled'); assert.equal(h.successes(), 0); h.worker.stop();
});
test('HTTP 400 is terminal and does not retry', async () => {
  let posts = 0; const h = setup({ add: async () => { posts++; return { status: 400, body: { message: 'Invalid dates' } }; } });
  await h.worker.start(booking); await h.clock.advance(10000); assert.equal(posts, 1); assert.equal(h.worker.status.state, 'error'); assert.match(h.worker.status.lastMessage, /Invalid dates/);
});
test('minimum stay is displayed without indefinite polling', async () => {
  const h = setup({ add: async () => ({ status: 417, body: { faults: [{ defaultMessage: 'Minimum length of stay is 2 nights', msgKey: 'R7-V-100002.error' }] } }) });
  await h.worker.start(booking); await flush(); assert.equal(h.worker.status.state, 'error'); assert.match(h.worker.status.lastMessage, /Minimum length/);
});
test('WAF verification is distinct from invalid login and is not retried', async () => {
  const h = setup({ cart: async () => ({ status: 405, reason: 'verification_required', error: 'Complete browser verification' }) });
  await h.worker.start(booking); await flush(); assert.equal(h.worker.status.reason, 'verification_required'); assert.equal(h.posts.length, 0);
});
test('existing exact cart item succeeds without another POST', async () => {
  const h = setup({ cart: async () => cart() }); await h.worker.start(booking); await flush(); assert.equal(h.posts.length, 0); assert.equal(h.successes(), 1);
});
test('unrelated cart contents or different dates cannot produce success', () => {
  for (const c of [{ arrivalDate: '2027-05-19' }, { units: 3 }, { site: { id: 99 } }]) assert.equal(findCartItem(cart(c).body, booking), null);
  assert.equal(findCartItem({ itemsCount: 9, lastChanges: { addedItems: ['1'] } }, booking), null);
});
test('HTTP 200 without matching item reports unconfirmed rather than retrying', async () => {
  const h = setup({ add: async () => cart({ units: 5 }) }); await h.worker.start(booking); await flush(); assert.equal(h.worker.status.state, 'error'); assert.equal(h.successes(), 0);
});
test('429 respects Retry-After globally', async () => {
  let posts = 0; const h = setup({ add: async () => ++posts === 1 ? { status: 429, retryAfter: '3' } : cart() });
  await h.worker.start(booking); await flush(); await h.clock.advance(2999); assert.equal(posts, 1); await h.clock.advance(1); assert.equal(posts, 2); assert.equal(h.successes(), 1);
});
test('persistent throttling stops after five attempts', async () => {
  let posts = 0; const h = setup({ add: async () => { posts++; return { status: 429 }; } }); await h.worker.start(booking); await h.clock.advance(20000); assert.equal(posts, 5); assert.equal(h.worker.status.state, 'error');
});
test('ambiguous network failure checks cart before a repeated POST', async () => {
  let gets = 0, posts = 0; const h = setup({ cart: async () => ++gets === 1 ? empty : cart(), add: async () => { posts++; return { status: 0, reason: 'timeout' }; } });
  await h.worker.start(booking); await flush(); assert.equal(posts, 1); assert.equal(h.successes(), 1);
});
test('expected too-early fault near opening retries then succeeds', async () => {
  let posts = 0; const h = setup({ add: async () => ++posts === 1 ? { status: 417, body: { faults: [{ msgKey: 'R6-V-100013.error', defaultMessage: 'cannot be reserved at this time' }] } } : cart() });
  await h.worker.start({ ...booking, mode: 'queue', unlockAtMs: h.clock.time + 1000 }); await h.clock.advance(1000); assert.equal(posts, 1); await h.clock.advance(100); assert.equal(h.successes(), 1);
});
test('hung POST is cancelled by independent deadline', async () => {
  let signal; const h = setup({ add: (_, o) => { signal = o.signal; return new Promise(() => {}); } }); await h.worker.start(booking); await h.clock.advance(300000); assert.equal(h.worker.status.state, 'stopped'); assert.ok(signal.aborted); assert.equal(h.awake(), 0);
});
test('duplicate starts are rejected before waiting for preflight', async () => {
  const h = setup({ cart: () => new Promise(() => {}) }); await h.worker.start(booking); assert.equal((await h.worker.start(booking)).ok, false); h.worker.stop();
});
test('invalid input is rejected before acquiring sleep blocker', async () => {
  for (const change of [{ nights: -1 }, { nights: 1.5 }, { startDate: '2027-02-31' }, { mode: 'queue', unlockAtMs: 0 }]) { const h = setup(); assert.equal((await h.worker.start({ ...booking, ...change })).ok, false); assert.equal(h.awake(), 0); }
});
test('network failures and expired login remain distinct', () => { assert.equal(classify({ status: 0, reason: 'connection_error' }), 'transient'); assert.equal(classify({ status: 401 }), 'signed_out'); });
test('Start over clears the main-process success snapshot for future renderer reloads', async () => {
  const h = setup(); await h.worker.start(booking); await flush(); assert.equal(h.worker.status.state, 'success'); assert.equal(h.worker.reset().ok, true); assert.equal(h.worker.status.state, 'idle');
});
test('Start over cannot discard an active scheduled run', async () => {
  const h = setup(); await h.worker.start({ ...booking, mode: 'queue', unlockAtMs: h.clock.time + 60000 }); await flush(); assert.equal(h.worker.reset().ok, false); assert.equal(h.worker.status.state, 'scheduled'); h.worker.stop();
});

test('tomorrow is rejected even when it is less than 24 hours away', async () => {
  let checks = 0;
  const h = setup({ cart: async () => { checks++; return empty; } });
  h.clock.time = Date.parse('2026-10-14T03:58:00Z'); // Oct 13, 11:58 PM Eastern.
  const result = await h.worker.start({ ...booking, mode: 'queue', unlockAtMs: Date.parse('2026-10-14T04:01:00Z') });
  assert.equal(result.ok, false); assert.match(result.error, /Only today/);
  assert.equal(checks, 0); assert.equal(h.awake(), 0);
});
test('opening timezone is required and invalid zones are rejected', async () => {
  for (const openingTimezone of [undefined, 'Not/AZone']) {
    const h = setup();
    const result = await h.worker.start({ ...booking, mode: 'queue', openingTimezone, unlockAtMs: h.clock.time + 60000 });
    assert.equal(result.ok, false); assert.match(result.error, /timezone/); assert.equal(h.awake(), 0);
  }
});
test('today is evaluated in the selected opening timezone', async () => {
  const h = setup(); h.clock.time = Date.parse('2026-10-14T02:00:00Z');
  // Still Oct 13 in California; this opening is later that same local day.
  const result = await h.worker.start({ ...booking, mode: 'queue', openingTimezone: 'America/Los_Angeles', unlockAtMs: Date.parse('2026-10-14T06:00:00Z') });
  assert.equal(result.ok, true); await flush(); assert.equal(h.worker.status.state, 'scheduled'); h.worker.stop();
});
