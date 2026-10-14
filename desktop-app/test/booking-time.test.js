const test = require('node:test');
const assert = require('node:assert/strict');
const { openingTimestamp, datePlusNights, todayOpening } = require('../renderer/booking-time');
test('opening timezone handles DST independently of computer timezone', () => {
  assert.equal(new Date(openingTimestamp('2027-07-13T09:00', 'America/New_York')).toISOString(), '2027-07-13T13:00:00.000Z');
  assert.equal(new Date(openingTimestamp('2027-01-13T09:00', 'America/New_York')).toISOString(), '2027-01-13T14:00:00.000Z');
  assert.equal(new Date(openingTimestamp('2027-07-13T09:00', 'America/Los_Angeles')).toISOString(), '2027-07-13T16:00:00.000Z');
});
test('calendar nights stay stable across DST', () => { assert.equal(datePlusNights('2027-03-13', 2), '2027-03-15'); });
test('nonexistent DST wall time is rejected', () => { assert.ok(Number.isNaN(openingTimestamp('2027-03-14T02:30', 'America/New_York'))); });

test('today opening never silently rolls a passed time to tomorrow', () => {
  const now = Date.parse('2026-10-13T16:00:00Z');
  const opening = todayOpening('09:00', 'America/New_York', now);
  assert.equal(opening, Date.parse('2026-10-13T13:00:00Z')); assert.ok(opening < now);
});
test('today follows the selected timezone when the UTC date differs', () => {
  const now = Date.parse('2026-10-14T02:00:00Z');
  assert.equal(todayOpening('20:00', 'America/Los_Angeles', now), Date.parse('2026-10-14T03:00:00Z'));
});
test('today opening applies daylight saving rules', () => {
  assert.equal(todayOpening('09:00', 'America/New_York', Date.parse('2026-11-01T12:00:00Z')), Date.parse('2026-11-01T14:00:00Z'));
});
