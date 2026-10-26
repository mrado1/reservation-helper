'use strict';
const { randomUUID } = require('node:crypto');
const { setMaxListeners } = require('node:events');
const { dateInZone } = require('../renderer/booking-time');

function findCartItem(cart, booking) {
  if (!Array.isArray(cart?.contractViewList)) return null;
  for (const contract of cart.contractViewList) {
    for (const item of contract.cartOrderViews || []) {
      const order = item.webOrder;
      if (String(item.contractCode || contract.contractCode) === booking.contractCode &&
          String(item.parkId) === String(booking.facilityId) &&
          String(order?.site?.id) === String(booking.siteId) &&
          order.arrivalDate === booking.startDate && Number(order.units) === booking.nights &&
          !item.inventoryNotAvailable && !item.inventoryNotOnHold) return item;
    }
  }
  return null;
}
function serverMessage(result) {
  return result.error || result.body?.faults?.[0]?.defaultMessage || result.body?.faults?.[0]?.messageTemplate || result.body?.message || `Reserve America returned HTTP ${result.status}.`;
}
function classify(result) {
  if (result.reason === 'signed_out' || result.status === 401 || result.status === 403) return 'signed_out';
  if (result.reason === 'verification_required' || result.status === 405 || result.status === 202) return 'verification_required';
  if (['unexpected_response', 'page_not_ready', 'cancelled', 'preparation_failed'].includes(result.reason)) return 'terminal';
  if (result.status === 429) return 'rate_limited';
  if (result.status === 0 || result.status >= 500) return 'transient';
  if (result.ok && result.status === 200) return 'verify';
  const fault = result.body?.faults?.[0];
  if (result.status === 417 && (/R1-V-100017|R6-V-100013/.test(fault?.msgKey || '') || /within 9 Month|cannot be reserved at this time|try again later at/i.test(serverMessage(result)))) return 'too_early';
  if (result.status === 409 || /inventory.exception|overlap/i.test(fault?.msgKey || '') || /overlapping/i.test(serverMessage(result))) return 'inventory';
  return 'terminal';
}
function retryDelay(value, now) {
  const seconds = Number(value);
  if (value && Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1000, date - now) : 2000;
}
function explicitRetryDelay(value, now) {
  if (value == null || String(value).trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}
function validateBooking(input, now = Date.now()) {
  if (!input || !/^\d+$/.test(String(input.facilityId)) || !/^\d+$/.test(String(input.siteId)) || !/^[A-Z]{2}$/.test(input.contractCode)) throw Error('Choose a campsite on Reserve America first.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || new Date(input.startDate + 'T12:00:00Z').toISOString().slice(0, 10) !== input.startDate) throw Error('Choose a valid arrival date.');
  if (!Number.isInteger(input.nights) || input.nights < 1 || input.nights > 14) throw Error('Choose between 1 and 14 nights.');
  if (input.mode !== 'add' && input.mode !== 'queue') throw Error('Choose Add now or Schedule.');
  if (input.mode === 'queue') {
    if (!input.openingTimezone) throw Error('Choose the opening timezone.');
    if (!Number.isFinite(input.unlockAtMs) || input.unlockAtMs <= now) throw Error('Today’s opening time has passed. Choose Add now to try immediately.');
    let today, openingDay;
    try { today = dateInZone(now, input.openingTimezone); openingDay = dateInZone(input.unlockAtMs, input.openingTimezone); }
    catch { throw Error('Choose a valid opening timezone.'); }
    if (today !== openingDay) throw Error('Only today’s opening can be scheduled. Return 3–5 minutes before reservations open.');
  }
  return Object.freeze({ ...input });
}

class BookingWorker {
  constructor({ client, onStatus, onSuccess, keepAwake = () => () => {}, now = Date.now, timers = globalThis, maxDurationMs = 300000, cadenceMs = 10, maxConcurrent = 100, earlyStartMs = 5000, random = Math.random }) {
    Object.assign(this, { client, onStatus, onSuccess, keepAwake, now, timers, maxDurationMs, cadenceMs, maxConcurrent, earlyStartMs, random });
    this.run = null;
    this.status = { state: 'idle', requestCount: 0, elapsedMs: 0, maxDurationMs };
  }
  active(run) { return this.run === run && !run.controller.signal.aborted; }
  emit(run, state, message, extra = {}) {
    if (!this.active(run)) return;
    this.status = { state, lastMessage: message, requestCount: run.requests, elapsedMs: run.startedAt == null ? 0 : this.now() - run.startedAt, maxDurationMs: this.maxDurationMs, unlockAtMs: run.booking.unlockAtMs, booking: run.booking, inFlight: run.inFlight || 0, network: run.network ? { ...run.network } : undefined, preparation: run.preparation, firstRequestAtMs: run.firstRequestAtMs, burstStartAtMs: run.booking.mode === 'queue' ? run.booking.unlockAtMs - this.earlyStartMs : null, lastUpdated: this.now(), ...extra };
    this.onStatus(this.status);
  }
  finish(run, state, message, extra) {
    if (!this.active(run)) return;
    this.emit(run, state, message, extra);
    this.run = null;
    run.controller.abort();
    if (run.deadline) this.timers.clearTimeout(run.deadline);
    run.releaseAwake();
    if (state === 'success') this.onSuccess(run.booking);
  }
  reset() {
    if (this.run) return { ok: false, error: 'Stop the active attempt first.' };
    this.status = { state: 'idle', requestCount: 0, elapsedMs: 0, maxDurationMs: this.maxDurationMs };
    this.onStatus(this.status);
    return { ok: true };
  }
  stop() { if (this.run) this.finish(this.run, 'stopped', 'Stopped. No more requests will be sent.'); }
  options(run, refresh = false) { return { signal: run.controller.signal, group: run.id, refresh }; }
  addOptions(run) { return { ...this.options(run), prepared: run.booking.mode === 'queue' && this.now() < run.booking.unlockAtMs + 30000 }; }
  wait(run, ms) {
    return new Promise(resolve => {
      if (!this.active(run)) return resolve();
      const done = () => { this.timers.clearTimeout(timer); run.controller.signal.removeEventListener('abort', done); resolve(); };
      const timer = this.timers.setTimeout(done, Math.max(0, ms));
      run.controller.signal.addEventListener('abort', done, { once: true });
    });
  }
  async start(input) {
    if (this.run) return { ok: false, error: 'A reservation attempt is already active.' };
    let booking;
    try { booking = validateBooking(input, this.now()); } catch (e) { return { ok: false, error: e.message }; }
    const run = { id: randomUUID(), booking, controller: new AbortController(), requests: 0, startedAt: null, releaseAwake: this.keepAwake(), deadline: null };
    setMaxListeners(this.maxConcurrent + 10, run.controller.signal);
    this.run = run;
    this.emit(run, 'checking', 'Checking your connection and cart…');
    this.execute(run).catch(() => this.finish(run, 'error', 'The reservation attempt failed. Reload Reserve America and retry.'));
    return { ok: true };
  }
  async checkCart(run, refresh = false) {
    const result = await (refresh && this.client.prepare ? this.client.prepare(this.options(run, refresh)) : this.client.cart(this.options(run, refresh)));
    if (refresh && result.timing) run.preparation = result.timing;
    if (!this.active(run)) return null;
    if (result.ok && Array.isArray(result.body?.contractViewList)) {
      if (findCartItem(result.body, run.booking)) { this.finish(run, 'success', 'Added to cart. Complete your details and checkout in Reserve America.', { lastHttpStatus: result.status }); return null; }
      return result;
    }
    this.finish(run, 'error', serverMessage(result), { lastHttpStatus: result.status, reason: classify(result) });
    return null;
  }
  observeNetwork(event) {
    const run = this.run;
    if (!run || !this.active(run) || run.startedAt == null || event.runId !== run.id) return;
    run.networkRequests ||= new Map();
    run.network ||= { sent: 0, completed: 0, inFlight: 0, peakInFlight: 0, totalResponseMs: 0 };
    const n = run.network;
    if (event.type === 'sent' && !run.networkRequests.has(event.id)) {
      run.networkRequests.set(event.id, event.at);
      n.firstSentAtMs ??= event.at;
      n.lastSentAtMs = event.at;
      n.sent++; n.inFlight++; n.peakInFlight = Math.max(n.peakInFlight, n.inFlight);
    } else if (event.type === 'complete' && run.networkRequests.has(event.id)) {
      const elapsed = Math.max(0, event.at - run.networkRequests.get(event.id));
      run.networkRequests.delete(event.id);
      n.inFlight--; n.completed++; n.totalResponseMs += elapsed;
      n.lastResponseMs = elapsed; n.lastStatus = event.status;
      if (event.wafAction) n.wafAction = event.wafAction;
      if (event.retryAfter) n.retryAfter = event.retryAfter;
    }
  }
  async burst(run) {
    run.inFlight = 0;
    run.pauseUntil = 0;
    run.cooldowns = [];
    run.pendingError = null;
    run.lastResult = {};
    run.lastReport = -Infinity;
    let verification = null;
    // Share cart reconciliation across racing responses. It must not serialize POSTs.
    const verify = () => {
      if (!verification) {
        verification = this.client.cart(this.options(run)).then(result => {
          if (!this.active(run)) return;
          if (findCartItem(result.body, run.booking)) {
            this.finish(run, 'success', 'Added to cart. Complete your details and checkout in Reserve America.', { lastHttpStatus: result.status });
          } else if (['signed_out', 'verification_required'].includes(classify(result))) {
            this.finish(run, 'error', serverMessage(result), { lastHttpStatus: result.status, reason: classify(result) });
          }
        }).catch(() => {}).finally(() => { verification = null; });
      }
      return verification;
    };
    const send = async () => {
      run.inFlight++;
      run.requests++;
      run.firstRequestAtMs ??= this.now();
      const b = run.booking;
      try {
        const result = await this.client.add({ contractCode: b.contractCode, facilityID: b.facilityId, siteID: b.siteId, arrivalDate: b.startDate, units: b.nights, quantity: 1, primaryItemID: null, primaryResNum: null }, this.addOptions(run));
        if (!this.active(run)) return;
        const kind = classify(result);
        const extra = { lastHttpStatus: result.status, reason: kind };
        run.lastResult = extra;
        if (findCartItem(result.body, b)) {
          this.finish(run, 'success', 'Added to cart. Complete your details and checkout in Reserve America.', extra);
        } else if (kind === 'too_early' && this.now() < b.unlockAtMs + 30000) {
          // Refill the slot on the next tick, independently of other responses.
        } else if (kind === 'rate_limited') {
          const explicit = explicitRetryDelay(result.retryAfter, this.now());
          if (explicit !== null) run.pauseUntil = Math.max(run.pauseUntil, this.now() + explicit);
          else run.cooldowns.push(this.now() + 1000 + Math.floor(this.random() * 1000));
        } else if (kind === 'transient') {
          // No five-failure cutoff or exponential backoff at the release boundary.
          // A timed-out POST may have succeeded: reconcile without blocking the burst.
          void verify();
        } else if (['signed_out', 'verification_required'].includes(kind)) {
          this.finish(run, 'error', serverMessage(result), extra);
        } else {
          // An inventory/validation response can race another POST's success.
          // Stop refilling, allow in-flight replies to settle, then reconcile once.
          run.pendingError ||= { message: kind === 'verify' ? 'The selected campsite and dates were not confirmed in the cart.' : serverMessage(result), extra };
          void verify();
        }
      } catch {
        if (this.active(run)) { run.lastResult = { lastHttpStatus: 0, reason: 'transient' }; void verify(); }
      } finally {
        run.inFlight--;
      }
    };
    while (this.active(run)) {
      if (run.pendingError && run.inFlight === 0) {
        await verify();
        if (this.active(run)) this.finish(run, 'error', run.pendingError.message, run.pendingError.extra);
        return;
      }
      if (!run.pendingError && this.now() >= run.pauseUntil) {
        run.cooldowns = run.cooldowns.filter(until => until > this.now());
        const slots = Math.max(0, this.maxConcurrent - run.inFlight - run.cooldowns.length);
        for (let i = 0; i < slots && this.active(run); i++) void send();
      }
      // Bound UI/log work instead of emitting once per concurrent response.
      if (this.now() - run.lastReport >= 250) {
        run.lastReport = this.now();
        const message = run.pendingError ? 'Checking the cart and remaining responses…' : this.now() < run.pauseUntil ? 'Reserve America requested a pause. Retrying after its rate limit.' : 'Sending booking requests…';
        this.emit(run, 'polling', message, run.lastResult);
      }
      await this.wait(run, this.cadenceMs);
    }
  }
  async execute(run) {
    if (!await this.checkCart(run, true)) return;
    if (run.booking.mode === 'queue') {
      this.emit(run, 'scheduled', 'Waiting for today’s opening. Stay at your computer with the app open and be ready to finish checkout.');
      // Prepare auth before the five-second early burst, outside the opening-time path.
      while (this.active(run) && this.now() < run.booking.unlockAtMs - this.earlyStartMs - 15000) {
        await this.wait(run, Math.min(5 * 60000, run.booking.unlockAtMs - this.earlyStartMs - 15000 - this.now()));
        if (!this.active(run)) return;
        if (!await this.checkCart(run, true)) return;
      }
      if (!this.active(run)) return;
      // Use main-process timers; renderer countdowns never drive requests.
      if (this.now() > run.booking.unlockAtMs + this.maxDurationMs) { this.finish(run, 'error', 'The computer woke after the booking window. Schedule a new attempt.'); return; }
      await this.wait(run, run.booking.unlockAtMs - this.earlyStartMs - this.now());
    }
    if (!this.active(run)) return;
    if (run.booking.mode === 'queue' && this.now() > run.booking.unlockAtMs + this.maxDurationMs) { this.finish(run, 'error', 'The scheduled opening was missed. Schedule a new attempt.'); return; }
    run.startedAt = this.now();
    run.deadline = this.timers.setTimeout(() => this.finish(run, 'stopped', 'Stopped after five minutes. Check the cart before trying again.'), this.maxDurationMs);
    this.emit(run, 'polling', 'Adding your campsite to the cart…');
    if (run.booking.mode === 'queue') return this.burst(run);
    let failures = 0;
    while (this.active(run)) {
      run.requests++;
      const b = run.booking;
      const result = await this.client.add({ contractCode: b.contractCode, facilityID: b.facilityId, siteID: b.siteId, arrivalDate: b.startDate, units: b.nights, quantity: 1, primaryItemID: null, primaryResNum: null }, this.addOptions(run));
      if (!this.active(run)) return;
      const kind = classify(result);
      const extra = { lastHttpStatus: result.status, reason: kind };
      // The successful response contains the cart. Match identity AND dates, never just its count.
      if (findCartItem(result.body, b)) { this.finish(run, 'success', 'Added to cart. Complete your details and checkout in Reserve America.', extra); return; }
      if (['verify', 'inventory', 'transient'].includes(kind)) {
        this.emit(run, 'polling', 'Checking whether your campsite reached the cart…', extra);
        if (!await this.checkCart(run)) return;
      }
      if (kind === 'verify') { this.finish(run, 'error', 'Reserve America responded, but the selected campsite and dates were not confirmed in the cart. Check the cart before retrying.', extra); return; }
      if (kind === 'too_early' && b.mode === 'queue' && this.now() < b.unlockAtMs + 30000) {
        this.emit(run, 'polling', 'Waiting for Reserve America to open this campsite…', extra);
        await this.wait(run, this.cadenceMs);
        continue;
      }
      if (kind === 'rate_limited' || kind === 'transient') {
        if (++failures >= 5) { this.finish(run, 'error', `Stopped after repeated failures. ${serverMessage(result)}`, extra); return; }
        const pause = kind === 'rate_limited' ? retryDelay(result.retryAfter, this.now()) : Math.min(500 * 2 ** (failures - 1), 8000);
        this.emit(run, 'polling', `Waiting ${Math.ceil(pause / 1000)} seconds before retrying. ${serverMessage(result)}`, extra);
        await this.wait(run, pause);
        continue;
      }
      this.finish(run, 'error', serverMessage(result), extra);
      return;
    }
  }
}
module.exports = { BookingWorker, findCartItem, classify, validateBooking, retryDelay, explicitRetryDelay };
