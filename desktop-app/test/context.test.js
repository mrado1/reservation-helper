const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../main.js'), 'utf8');
const extraction = source.slice(source.indexOf('function contextSignature'), source.indexOf('function createWindow'));
test('advertisement navigation cannot clear the selected campsite', async () => {
  const page = 'https://www.reserveamerica.com/explore/test/NY/140/245719/campsite-booking';
  const context = vm.createContext({ lastContext: { siteId: '245719' }, lastContextSignature: '', BrowserWindow: { getAllWindows: () => [] }, console, setTimeout: f => f() });
  vm.runInContext(extraction, context);
  context.view = { isDestroyed: () => false, getURL: () => page };
  await vm.runInContext("extractContext(view, 'https://ads.example.com/frame')", context);
  assert.equal(context.lastContext.siteId, '245719');
});
test('main-frame campsite URL produces the correct selection', async () => {
  const page = 'https://www.reserveamerica.com/explore/test/NY/140/245719/campsite-booking';
  const context = vm.createContext({ lastContext: null, lastContextSignature: '', BrowserWindow: { getAllWindows: () => [] }, console, setTimeout: f => f() });
  vm.runInContext(extraction, context);
  context.view = { isDestroyed: () => false, getURL: () => page, mainFrame: { executeJavaScript: async () => ({ facilityName: 'Campground', siteName: 'BB001' }) } };
  context.page = page;
  await vm.runInContext('extractContext(view, page)', context);
  assert.equal(context.lastContext.facilityId, '140'); assert.equal(context.lastContext.siteId, '245719'); assert.equal(context.lastContext.siteName, 'BB001');
});
