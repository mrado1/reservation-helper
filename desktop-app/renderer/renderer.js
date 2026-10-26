'use strict';
const $ = id => document.getElementById(id);
const view = $('raView');
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
function selectTimezone(zone) {
  const select = $('openingTimezone');
  if (zone && !Array.from(select.options).some(option => option.value === zone)) {
    select.add(new Option(zone.replaceAll('_', ' '), zone));
  }
  select.value = zone;
}
selectTimezone(localTimezone);
let context = null;
let auth = { ok: false, reason: 'checking' };
let status = { state: 'idle' };
let starting = false;
let authPending = null;
let authTimer;
let lastAuthCheck = 0;
let selectedUrl = '';
let scheduleSite = '';
const touched = new Set();
const active = () => starting || ['checking', 'scheduled', 'polling'].includes(status.state);
const locked = () => active() || status.state === 'success';
const text = (id, value) => { $(id).textContent = value || ''; };
const show = (id, visible) => $(id).classList.toggle('hidden', !visible);

function renderAuth() {
  text('step1Status', auth.ok ? 'Connected to Reserve America' : auth.reason === 'signed_out' ? 'Sign in required' : auth.reason === 'checking' ? 'Checking connection…' : 'Connection needs attention');
  text('authStatus', auth.ok ? '' : auth.error || (auth.reason === 'signed_out' ? 'Use the button below to sign in on the right. We’ll check your connection automatically.' : auth.reason === 'checking' ? 'Waiting for the website…' : 'Could not verify your connection. Retry after the page finishes loading.'));
  $('retryAuth').disabled = !!authPending || active();
  $('loginCta').disabled = active();
  show('loginCta', !auth.ok);
  renderForm();
}
async function checkAuth() {
  if (authPending || active()) return authPending;
  if (!view.getURL?.().startsWith('https://www.reserveamerica.com/')) return;
  lastAuthCheck = Date.now();
  const checkedUrl = view.getURL();
  authPending = window.ra.authProbe();
  $('retryAuth').disabled = true;
  try { const result = await authPending; if (view.getURL() === checkedUrl) auth = result; } catch { auth = { ok: false, error: 'Could not check the connection. Retry.' }; }
  finally { authPending = null; renderAuth(); if (view.getURL() !== checkedUrl) scheduleAuthCheck(); }
}
function scheduleAuthCheck() {
  if (authPending || active()) return;
  clearTimeout(authTimer);
  authTimer = setTimeout(checkAuth, Math.max(700, 5000 - (Date.now() - lastAuthCheck)));
}
$('retryAuth').addEventListener('click', checkAuth);
$('loginCta').addEventListener('click', () => { view.src = 'https://www.reserveamerica.com/signin'; });
window.ra.onCookieChanged(scheduleAuthCheck);

function renderContext(ctx) {
  context = ctx;
  text('step2Status', ctx?.siteId ? 'Review your campsite, then enter your stay dates below. Dates on the right are optional.' : 'Choose a campsite on the right. You don’t need to select dates there—enter your arrival date and number of nights below.');
  text('facilityName', ctx?.facilityName || 'Campground selected');
  text('siteName', ctx?.siteName || (ctx?.siteId ? 'Campsite selected — refresh to load its name.' : ''));
  show('selectedCampsite', !!ctx?.siteId);
  show('refreshContext', !!ctx?.siteId);
  show('releaseRules', /\/NY\/\d+\//.test(ctx?.url || '') || ctx?.contractCode === 'NY');
  const siteKey = ctx?.siteId ? `${ctx.contractCode || ctx.url?.match(/\/([A-Z]{2})\/\d+\//)?.[1] || ''}/${ctx.facilityId}` : '';
  if (siteKey && siteKey !== scheduleSite) {
    scheduleSite = siteKey;
    $('openingTime').value = '09:00';
    selectTimezone(localTimezone);
    touched.delete('openingTime');
    touched.delete('openingTimezone');
  }
  if (ctx?.siteId && selectedUrl !== ctx.url) {
    selectedUrl = ctx.url;
    const url = new URL(ctx.url);
    if (!touched.has('startDate') && /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('arrivalDate') || '')) $('startDate').value = url.searchParams.get('arrivalDate');
    const nights = Number(url.searchParams.get('lengthOfStay'));
    if (!touched.has('nights') && Number.isInteger(nights) && nights >= 1) $('nights').value = nights;
  }
  renderForm();
}
window.ra.onContextChanged(ctx => { if (!locked()) renderContext(ctx); });
async function refreshSelection() {
  if (locked()) return;
  const ctx = await window.ra.getContext();
  if (!locked()) renderContext(ctx);
}
$('refreshContext').addEventListener('click', refreshSelection);
view.addEventListener('did-stop-loading', refreshSelection);

function form() {
  const startDate = $('startDate').value;
  const nights = Number($('nights').value);
  const mode = $('bookingWhen').value;
  const errors = [];
  let unlockAtMs = null;
  if (!context?.siteId || !context?.facilityId) errors.push('Choose a campsite on the right.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) errors.push('Choose an arrival date.');
  if (!Number.isInteger(nights) || nights < 1 || nights > 14) errors.push('Choose 1–14 nights.');
  if (mode === 'queue') {
    try { unlockAtMs = BookingTime.todayOpening($('openingTime').value, $('openingTimezone').value); } catch {}
    if (!$('openingTime').value) errors.push('Enter the reservation opening time.');
    if (!$('openingTimezone').value) errors.push('Choose the opening timezone.');
    if ($('openingTime').value && $('openingTimezone').value) {
      if (!Number.isFinite(unlockAtMs)) errors.push('Choose a valid opening time and timezone.');
      else if (unlockAtMs <= Date.now()) errors.push('Today’s opening time has passed.');
    }
  }
  return { startDate, nights, mode, unlockAtMs, openingTimezone: $('openingTimezone').value, errors };
}
function renderForm() {
  const f = form();
  show('scheduleFields', f.mode === 'queue');
  text('dateRange', f.startDate && Number.isInteger(f.nights) && f.nights > 0 ? `Checkout: ${new Date(BookingTime.datePlusNights(f.startDate, f.nights) + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : '');
  text('formErrors', locked() ? '' : !auth.ok ? 'Sign in to continue.' : f.errors[0]);
  $('formErrors').dataset.invalid = String(touched.has('openingTime') && !!$('openingTime').value && $('openingTimezone').value && (!Number.isFinite(f.unlockAtMs) || f.unlockAtMs <= Date.now()) && f.mode === 'queue');
  const displayedOpening = active() && status.unlockAtMs ? status.unlockAtMs : f.unlockAtMs;
  text('localOpening', Number.isFinite(displayedOpening) && f.openingTimezone !== localTimezone ? `Your time: ${new Date(displayedOpening).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}` : '');
  show('addNowInstead', !locked() && f.mode === 'queue' && Number.isFinite(f.unlockAtMs) && f.unlockAtMs <= Date.now());
  $('actionBtn').disabled = !auth.ok || !!f.errors.length || locked();
  text('actionBtn', starting ? 'Starting…' : f.mode === 'queue' ? 'Wait for today’s opening' : 'Add to cart');
  show('actionBtn', !locked());
  show('stopPollingBtn', active());
  text('stopPollingBtn', status.state === 'scheduled' ? 'Cancel schedule' : 'Stop trying');
  for (const id of ['startDate', 'nights', 'bookingWhen', 'openingTime', 'openingTimezone', 'refreshContext']) $(id).disabled = locked();
}
for (const id of ['startDate', 'nights', 'bookingWhen', 'openingTime', 'openingTimezone']) $(id).addEventListener('input', () => { touched.add(id); renderForm(); });
$('addNowInstead').addEventListener('click', () => { $('bookingWhen').value = 'add'; renderForm(); });
$('actionBtn').addEventListener('click', async () => {
  const { errors, ...data } = form();
  if (errors.length || !auth.ok || locked()) return;
  starting = true;
  renderForm();
  try {
    const result = await window.ra.startPolling(data);
    if (!result.ok) renderStatus({ state: 'error', lastMessage: result.error });
  } catch { renderStatus({ state: 'error', lastMessage: 'Could not start. Retry once the page finishes loading.' }); }
  finally { starting = false; renderForm(); }
});
$('stopPollingBtn').addEventListener('click', async () => { await window.ra.stopPolling(); starting = false; renderStatus(await window.ra.getPollingStatus()); await refreshSelection(); });
function renderStatus(next) {
  status = next;
  const names = { idle: 'Ready', checking: 'Checking connection', scheduled: 'Scheduled', polling: 'Adding to cart', stopped: 'Stopped', error: 'Needs attention', success: 'Added to cart' };
  text('pollingState', names[status.state]);
  text('pollingRequests', String(status.requestCount || 0));
  text('pollingElapsed', `${Math.round((status.elapsedMs || 0) / 1000)}s`);
  text('pollingLastStatus', status.lastHttpStatus ? `HTTP ${status.lastHttpStatus}` : '—');
  text('pollingMessage', status.lastMessage);
  show('attemptStatus', status.state !== 'idle');
  show('countdownSection', status.state === 'scheduled');
  show('runCompleteOverlay', status.state === 'success');
  if (['scheduled', 'polling', 'success'].includes(status.state)) { auth = { ok: true }; renderAuth(); }
  if (status.reason === 'signed_out' || status.reason === 'verification_required') { auth = { ok: false, reason: status.reason, error: status.lastMessage }; renderAuth(); }
  updateCountdown();
  renderForm();
}
window.ra.onPollingStatus(renderStatus);
window.ra.onNavigateToCart(() => { view.src = 'https://www.reserveamerica.com/explore/cart/view'; });
$('startOverBtn').addEventListener('click', async () => {
  await window.ra.resetPolling();
  $('bookingWhen').value = 'queue';
  $('openingTime').value = '09:00';
  selectTimezone(localTimezone);
  renderStatus({ state: 'idle' });
  renderContext(await window.ra.getContext());
  view.src = 'https://www.reserveamerica.com/';
});
function updateCountdown() {
  if (status.state !== 'scheduled') return;
  const remaining = Math.max(0, status.unlockAtMs - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  text('countdownTarget', `Starts ${new Date(status.unlockAtMs).toLocaleString()} (your local time)`);
  text('countdownClock', `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s remaining`);
}
setInterval(() => { updateCountdown(); if (!locked() && $('bookingWhen').value === 'queue') renderForm(); }, 1000);

function renderLogs(entries) {
  $('logsList').replaceChildren();
  show('logsEmpty', !entries.length);
  for (const entry of entries.slice(-300)) {
    const li = document.createElement('li');
    li.className = 'border-b border-slate-200 py-2 text-xs';
    li.textContent = `${new Date(entry.ts).toLocaleTimeString()} · ${entry.state || entry.source}${entry.httpStatus ? ` · HTTP ${entry.httpStatus}` : ''}\n${entry.message || ''}`;
    if (entry.requestCount != null) li.textContent += `\nRequests: ${entry.requestCount} · In flight: ${entry.inFlight || 0}`;
    if (entry.firstRequestAtMs != null && entry.burstStartAtMs != null) li.textContent += ` · First dispatch: ${entry.firstRequestAtMs - entry.burstStartAtMs} ms after burst target`;
    $('logsList').append(li);
  }
}
window.ra.onLogsUpdated(renderLogs);
$('clearLogsBtn').addEventListener('click', () => window.ra.clearLogs());
for (const name of ['Booking', 'Logs']) $('tab' + name).addEventListener('click', () => {
  show('bookingPane', name === 'Booking'); show('logsPane', name === 'Logs');
  $('tabBooking').style.borderBottomColor = name === 'Booking' ? '#0f172a' : 'transparent';
  $('tabLogs').style.borderBottomColor = name === 'Logs' ? '#0f172a' : 'transparent';
});
$('backBtn').addEventListener('click', () => { if (view.canGoBack()) view.goBack(); });
$('forwardBtn').addEventListener('click', () => { if (view.canGoForward()) view.goForward(); });
$('refreshBtn').addEventListener('click', () => view.reload());
function navigation() {
  if (view.getURL().includes('/explore/my-account/dashboard')) { view.src = 'https://www.reserveamerica.com/'; return; }
  text('urlDisplay', ''); $('urlDisplay').value = view.getURL();
  $('backBtn').disabled = !view.canGoBack(); $('forwardBtn').disabled = !view.canGoForward();
  scheduleAuthCheck();
}
for (const event of ['dom-ready', 'did-navigate', 'did-navigate-in-page']) view.addEventListener(event, navigation);
view.addEventListener('did-fail-load', e => { if (e.isMainFrame && e.errorCode !== -3) { auth = { ok: false, error: 'Could not load Reserve America. Check your connection and reload.' }; renderAuth(); } });
window.addEventListener('online', () => { show('offlineState', false); scheduleAuthCheck(); });
window.addEventListener('offline', () => show('offlineState', true));
setInterval(() => { if (!active() && status.state !== 'success') checkAuth(); }, 60000);
(async () => {
  const saved = await window.ra.getPollingStatus();
  if (saved.booking && ['checking', 'scheduled', 'polling', 'success'].includes(saved.state)) {
    $('startDate').value = saved.booking.startDate; $('nights').value = saved.booking.nights;
    renderContext({ ...saved.booking, url: '', status: 'complete' });
    $('bookingWhen').value = saved.booking.mode;
    if (saved.booking.mode === 'queue') {
      selectTimezone(saved.booking.openingTimezone || localTimezone);
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: $('openingTimezone').value, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(saved.booking.unlockAtMs).map(p => [p.type, p.value]));
      $('openingTime').value = `${parts.hour}:${parts.minute}:${parts.second}`;
    }
  } else renderContext(await window.ra.getContext());
  renderStatus(saved);
  renderLogs(await window.ra.getLogs());
  if (view.getAttribute('src') === 'about:blank') view.src = 'https://www.reserveamerica.com/';
})().catch(() => { text('authStatus', 'Could not initialize. Restart the app.'); });
