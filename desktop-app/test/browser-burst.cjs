// Isolated Electron/Chromium transport test. All HTTPS is intercepted in this
// test session: no real ReserveAmerica requests or credentials are used.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const { BookingWorker } = require('../lib/booking-worker');
const { createRaClient } = require('../lib/ra-client');
const empty = { contractViewList: [] };
const booked = { contractViewList: [{ contractCode: 'NY', cartOrderViews: [{ contractCode: 'NY', parkId: 140, webOrder: { site: { id: 245719 }, arrivalDate: '2027-05-18', units: 2 } }] }] };
let window, guard;
app.whenReady().then(async () => {
  guard = setTimeout(() => { console.error('Browser burst test timed out'); app.exit(1); }, 20000);
  const isolated = session.fromPartition('reservation-burst-test-' + Date.now());
  const sends = []; let active = 0, peak = 0, refreshes = 0, held = false, opening;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  isolated.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.pathname === '/refreshAuth') { refreshes++; return json({ idToken: 'test-only', a1Data: {}, refreshToken: 'test-only' }); }
    if (url.pathname.endsWith('/additem')) {
      sends.push(Date.now()); active++; peak = Math.max(peak, active);
      const early = Date.now() < opening;
      await new Promise(resolve => setTimeout(resolve, 600)); active--;
      if (early) return json({ faults: [{ msgKey: 'R6-V-100013.error' }] }, 417);
      held = true; return json(booked);
    }
    if (url.pathname.endsWith('/shoppingcart/0')) return json(held ? booked : empty);
    if (url.hostname !== 'www.reserveamerica.com' || url.pathname !== '/test') return new Response('', { status: 404 });
    return new Response('<meta name="csrf-token" content="test-only"><script>document.cookie="a1Data=%7B%7D"; document.cookie="ra2Refresh=test-only"; window.AwsWafIntegration={fetch:fetch.bind(window)};</script>', { headers: { 'Content-Type': 'text/html' } });
  });
  window = new BrowserWindow({ show: false, webPreferences: { session: isolated, backgroundThrottling: false } });
  await window.loadURL('https://www.reserveamerica.com/test');
  opening = Date.now() + 6000;
  let successes = 0;
  const result = await new Promise(async (resolve, reject) => {
    const worker = new BookingWorker({ client: createRaClient(() => window.webContents), onStatus: status => { if (['error', 'stopped'].includes(status.state)) reject(Error(status.lastMessage)); }, onSuccess: () => { successes++; resolve(worker.status); } });
    const start = await worker.start({ facilityId: '140', siteId: '245719', contractCode: 'NY', startDate: '2027-05-18', nights: 2, mode: 'queue', openingTimezone: 'America/New_York', unlockAtMs: opening });
    if (!start.ok) reject(Error(start.error));
  });
  const atFinish = sends.length;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(successes, 1);
  assert.equal(sends.length, atFinish, 'no POSTs after success');
  assert.equal(peak, 100, '100 requests overlap through the browser bridge');
  assert.ok(sends[0] >= opening - 5000 && sends[0] < opening - 4500, 'five-second early start');
  assert.ok(sends[99] - sends[0] < 500, 'first 100 dispatch without waiting for 600ms replies');
  assert.equal(refreshes, 1, 'auth is prepared before the burst');
  console.log(JSON.stringify({ test: 'isolated Electron browser transport', peakConcurrent: peak, firstRequestRelativeToOpeningMs: sends[0] - opening, first100DispatchSpreadMs: sends[99] - sends[0], requestCount: sends.length, successRelativeToOpeningMs: result.lastUpdated - opening, refreshes, realNetworkRequests: 0 }));
  clearTimeout(guard); window.destroy(); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(guard); app.exit(1); });
