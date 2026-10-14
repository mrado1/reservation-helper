(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BookingTime = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function openingTimestamp(value, timeZone) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || '');
    if (!match) return NaN;
    const [year, month, day, hour, minute, second] = match.slice(1).map(v => Number(v || 0));
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    let stamp = wanted;
    for (let i = 0; i < 4; i++) {
      const p = Object.fromEntries(format.formatToParts(stamp).map(p => [p.type, p.value]));
      const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      if (wall === wanted) return stamp;
      stamp += wanted - wall;
    }
    return NaN; // Nonexistent local time at a DST transition.
  }
  function dateInZone(stamp, timeZone) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(stamp).map(p => [p.type, p.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function todayOpening(time, timeZone, now = Date.now()) {
    return openingTimestamp(`${dateInZone(now, timeZone)}T${time}`, timeZone);
  }
  function datePlusNights(date, nights) {
    const value = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(value.getTime())) return '';
    value.setUTCDate(value.getUTCDate() + nights);
    return value.toISOString().slice(0, 10);
  }
  return { openingTimestamp, dateInZone, todayOpening, datePlusNights };
});
