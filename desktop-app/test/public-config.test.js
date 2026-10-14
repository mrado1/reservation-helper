const test = require('node:test');
const assert = require('node:assert/strict');
const { publicConfig } = require('../lib/public-config');
test('packaged config excludes personal keys and arbitrary local secrets', () => {
  const c = publicConfig({ posthog: { apiKey: 'public-project-key', personalApiKey: 'private-key' }, password: 'private-password', defaultFlags: { booking_enabled: true } });
  assert.equal(c.posthog.apiKey, 'public-project-key'); assert.ok(!JSON.stringify(c).includes('private-'));
});
