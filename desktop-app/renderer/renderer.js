const authStatusEl = document.getElementById('authStatus');
const authChecksEl = document.getElementById('authChecks');
const loginBannerEl = document.getElementById('loginBanner');
const cookieUpdatesEl = document.getElementById('cookieUpdates');
const authLiveEl = document.getElementById('authLive');
const loginCta = document.getElementById('loginCta');
const contextStatusEl = document.getElementById('contextStatus');
const facilityIdEl = document.getElementById('facilityId');
const siteIdEl = document.getElementById('siteId');
const facilityNameEl = document.getElementById('facilityName');
const siteNameEl = document.getElementById('siteName');
const refreshContextBtn = document.getElementById('refreshContext');
const startDateEl = document.getElementById('startDate');
const nightsEl = document.getElementById('nights');
const dateRangeEl = document.getElementById('dateRange');
const formErrorsEl = document.getElementById('formErrors');
const bookingModeMessageEl = document.getElementById('bookingModeMessage');
const actionBtn = document.getElementById('actionBtn');
const stopPollingBtn = document.getElementById('stopPollingBtn');
const countdownSectionEl = document.getElementById('countdownSection');
const currentTimeClockEl = document.getElementById('currentTimeClock');
const countdownTargetEl = document.getElementById('countdownTarget');
const countdownClockEl = document.getElementById('countdownClock');
const countdownStatusEl = document.getElementById('countdownStatus');
const pollingStateEl = document.getElementById('pollingState');
const pollingRequestsEl = document.getElementById('pollingRequests');
const pollingElapsedEl = document.getElementById('pollingElapsed');
const pollingLastStatusEl = document.getElementById('pollingLastStatus');
const pollingMessageEl = document.getElementById('pollingMessage');
const raView = document.getElementById('raView');
const backBtn = document.getElementById('backBtn');
const forwardBtn = document.getElementById('forwardBtn');
const refreshBtn = document.getElementById('refreshBtn');
const urlDisplayEl = document.getElementById('urlDisplay');
const offlineStateEl = document.getElementById('offlineState');

// M9: Stepper + tabs + logs
const tabBookingBtn = document.getElementById('tabBooking');
const tabLogsBtn = document.getElementById('tabLogs');
const bookingPaneEl = document.getElementById('bookingPane');
const logsPaneEl = document.getElementById('logsPane');
const logsListEl = document.getElementById('logsList');
const logsEmptyEl = document.getElementById('logsEmpty');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const runCompleteOverlayEl = document.getElementById('runCompleteOverlay');
const startOverBtn = document.getElementById('startOverBtn');
const step1CircleEl = document.getElementById('step1Circle');
const step1StatusEl = document.getElementById('step1Status');
const step1DataEl = document.getElementById('step1Data');
const step2CircleEl = document.getElementById('step2Circle');
const step2StatusEl = document.getElementById('step2Status');
const step2DataEl = document.getElementById('step2Data');
const step3CircleEl = document.getElementById('step3Circle');
const step3StatusEl = document.getElementById('step3Status');
const step3DataEl = document.getElementById('step3Data');

let didRouteToLogin = false;
let loginPending = false;
let currentContext = null;
let bookingMode = 'add'; // 'add' | 'queue'
let countdownArmed = false;
let countdownInterval = null;
let countdownTargetTimestamp = null; // 8:59 AM - when we start polling
let countdownUnlockTimestamp = null; // 9:00 AM - what we show in countdown

// M9: Stepper + logs state
let lastAuthLoggedIn = false;
let lastAuthUpdatedAt = null;
let lastContextUpdatedAt = null;
let step3State = 'idle'; // idle | active | queue_armed | polling | success | error | stopped
let step3Detail = '';
const logEntries = [];
const LOG_LIMIT = 1000;
let runLocked = false; // Lock context/steps after a successful run

function formatShortTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setStepCircle(circleEl, index, state) {
  if (!circleEl) return;
  const base =
    'flex h-7 w-7 shrink-0 aspect-square items-center justify-center rounded-full border text-xs font-semibold leading-none';
  if (state === 'complete') {
    circleEl.className = `${base} border-[#2f6b4f] bg-[#2f6b4f] text-white`;
  } else if (state === 'active') {
    circleEl.className = `${base} border-[#2f6b4f] text-[#2f6b4f] bg-white`;
  } else if (state === 'error') {
    circleEl.className = `${base} border-red-500 text-red-600 bg-white`;
  } else {
    circleEl.className = `${base} border-slate-300 text-slate-500 bg-white`;
  }
  circleEl.textContent = String(index);
}

function updateStepper() {
  // Step 1: auth
  const step1State = lastAuthLoggedIn ? 'complete' : 'active';
  setStepCircle(step1CircleEl, 1, step1State);
  if (step1StatusEl) {
    const statusText = lastAuthLoggedIn ? 'Signed in.' : 'Not signed in.';
    step1StatusEl.innerHTML = `<span class="text-slate-500">Status:</span> <span class="text-slate-900">${statusText}</span>`;
  }
  if (step1DataEl) {
    if (lastAuthLoggedIn && lastAuthUpdatedAt) {
      step1DataEl.textContent = `Cookies detected and accepted by Reserve America at ${formatShortTime(lastAuthUpdatedAt)}.`;
    } else {
      step1DataEl.textContent = '';
    }
  }

  // Step 2: context
  const hasIds = !!(currentContext && currentContext.facilityId && currentContext.siteId);
  const ctxComplete = hasIds && currentContext?.status === 'complete';
  const step2State = ctxComplete ? 'complete' : hasIds ? 'active' : 'idle';
  setStepCircle(step2CircleEl, 2, step2State);
  if (step2StatusEl) {
    if (ctxComplete) {
      step2StatusEl.innerHTML = `<span class="text-slate-500">Status:</span> <span class="text-slate-900">Campsite detected.</span>`;
    } else if (hasIds) {
      step2StatusEl.innerHTML = `<span class="text-slate-500">Status:</span> <span class="text-slate-900">Campsite partially detected.</span>`;
    } else {
      step2StatusEl.innerHTML = `<span class="text-slate-500">Status:</span> <span class="text-slate-900">Waiting for campsite.</span>`;
    }
  }
  if (step2DataEl) {
    let detail = '';
    if (ctxComplete) {
      const facility = currentContext.facilityName || `Facility #${currentContext.facilityId}`;
      const site = currentContext.siteName || `Site #${currentContext.siteId}`;
      detail = `${facility} · ${site}`;
    } else if (hasIds) {
      detail = `Facility #${currentContext.facilityId}, Site #${currentContext.siteId}`;
    } else {
      detail = '';
    }
    if (lastContextUpdatedAt) {
      detail += ` (Updated: ${formatShortTime(lastContextUpdatedAt)})`;
    }
    step2DataEl.textContent = detail;
  }

  // Step 3: reserve
  let circleState = 'idle';
  if (step3State === 'success') circleState = 'complete';
  else if (step3State === 'error') circleState = 'error';
  else if (step3State === 'active' || step3State === 'queue_armed' || step3State === 'polling') circleState = 'active';
  setStepCircle(step3CircleEl, 3, circleState);

  if (step3StatusEl) {
    let value = 'Not started.';
    if (step3State === 'queue_armed') value = 'Queue armed.';
    else if (step3State === 'polling' || step3State === 'active') value = 'Polling in progress.';
    else if (step3State === 'success') value = 'Added to cart.';
    else if (step3State === 'error') value = 'Stopped with an error.';
    else if (step3State === 'stopped') value = 'Stopped.';
    step3StatusEl.innerHTML = `<span class="text-slate-500">Status:</span> <span class="text-slate-900">${value}</span>`;
  }
  if (step3DataEl) {
    step3DataEl.textContent = step3Detail || '';
  }
}

function addLogEntry(entry) {
  const enriched = {
    ts: Date.now(),
    source: entry.source || 'system',
    state: entry.state || '',
    httpStatus: entry.httpStatus,
    message: (entry.message || '').toString()
  };
  logEntries.push(enriched);
  if (logEntries.length > LOG_LIMIT) {
    logEntries.splice(0, logEntries.length - LOG_LIMIT);
  }
  renderLogs();
}

function renderLogs() {
  if (!logsListEl || !logsEmptyEl) return;
  if (!logEntries.length) {
    logsEmptyEl.classList.remove('hidden');
    logsListEl.innerHTML = '';
    return;
  }
  logsEmptyEl.classList.add('hidden');
  const items = logEntries
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((entry) => {
      const time = formatShortTime(entry.ts);
      const stateRaw = entry.state || '';
      const httpStatus = typeof entry.httpStatus === 'number' ? entry.httpStatus : null;

      // Normalize label: Request/Response, otherwise capitalized state
      let label = '';
      if (stateRaw) {
        const lower = stateRaw.toLowerCase();
        if (lower === 'request') {
          label = 'Request';
        } else if (lower === 'response') {
          label = 'Response';
        } else {
          label = stateRaw.charAt(0).toUpperCase() + stateRaw.slice(1);
        }
      }

      const metaParts = [label].filter(Boolean);
      const baseText = metaParts.join(' · ');

      // Build a color-coded pill for any HTTP status
      let pill = '';
      if (httpStatus != null) {
        let colorClasses =
          'border-slate-200 bg-slate-50 text-slate-600';
        if (httpStatus === 200) {
          colorClasses = 'border-emerald-200 bg-emerald-50 text-emerald-700';
        } else if (httpStatus === 0) {
          colorClasses = 'border-amber-200 bg-amber-50 text-amber-700';
        } else if (httpStatus >= 400 && httpStatus < 500) {
          colorClasses = 'border-orange-200 bg-orange-50 text-orange-700';
        } else if (httpStatus >= 500) {
          colorClasses = 'border-red-200 bg-red-50 text-red-700';
        }
        pill = `<span class="inline-flex items-center rounded-full border ${colorClasses} px-1.5 py-0.5 text-[10px] font-medium">HTTP ${httpStatus}</span>`;
      }

      const meta = pill
        ? (baseText ? `${baseText} · ${pill}` : pill)
        : baseText;

      // Color-code by HTTP status
      let statusClass = 'text-slate-500';
      if (httpStatus === 200) statusClass = 'text-emerald-600';
      else if (httpStatus === 0) statusClass = 'text-amber-600';
      else if (httpStatus >= 400 && httpStatus < 500) statusClass = 'text-orange-600';
      else if (httpStatus >= 500) statusClass = 'text-red-600';

      const msg = (entry.message || '').toString().replace(/\s+/g, ' ').trim();

      return `<li class="flex items-start gap-2">
        <span class="shrink-0 font-mono text-[11px] text-slate-500">${time}</span>
        <div class="flex-1 min-w-0">
          <div class="text-[11px] ${statusClass}">${meta}</div>
          <div class="text-[11px] text-slate-800 truncate" title="${msg}">${msg}</div>
        </div>
      </li>`;
    });
  logsListEl.innerHTML = items.join('');
}

// Initial logs from main process
if (window.ra?.getLogs && window.ra?.onLogsUpdated) {
  window.ra.getLogs().then((entries) => {
    if (Array.isArray(entries)) {
      entries.forEach((e) => {
        logEntries.push({
          ts: e.ts,
          source: e.source || 'system',
          state: e.state || e.kind || '',
          httpStatus: e.httpStatus,
          message: e.message || ''
        });
      });
      if (logEntries.length > LOG_LIMIT) {
        logEntries.splice(0, logEntries.length - LOG_LIMIT);
      }
      renderLogs();
    }
  }).catch(() => {});

  window.ra.onLogsUpdated((entries) => {
    logEntries.length = 0;
    if (Array.isArray(entries)) {
      entries.forEach((e) => {
        logEntries.push({
          ts: e.ts,
          source: e.source || 'system',
          state: e.state || e.kind || '',
          httpStatus: e.httpStatus,
          message: e.message || ''
        });
      });
    }
    renderLogs();
  });
}

function setActiveTab(tab) {
  const active =
    'inline-flex items-center border-b-2 border-slate-900 px-3 py-2 text-xs font-medium text-slate-900';
  const inactive =
    'inline-flex items-center border-b-2 border-transparent px-3 py-2 text-xs font-medium text-slate-500 hover:border-slate-300';
  if (tabBookingBtn && tabLogsBtn && bookingPaneEl && logsPaneEl) {
    if (tab === 'logs') {
      tabBookingBtn.className = inactive;
      tabLogsBtn.className = active;
      bookingPaneEl.classList.add('hidden');
      logsPaneEl.classList.remove('hidden');
    } else {
      tabBookingBtn.className = active;
      tabLogsBtn.className = inactive;
      bookingPaneEl.classList.remove('hidden');
      logsPaneEl.classList.add('hidden');
    }
  }
}

tabBookingBtn?.addEventListener('click', () => setActiveTab('booking'));
tabLogsBtn?.addEventListener('click', () => setActiveTab('logs'));
setActiveTab('booking');

// Clear logs action
clearLogsBtn?.addEventListener('click', async () => {
  try {
    await window.ra.clearLogs();
    // Local buffer will be cleared via ra:logsUpdated, but ensure immediate UX
    logEntries.length = 0;
    renderLogs();
  } catch {
    // noop
  }
});

// Start over action - reset UI for a new run and navigate back to RA home
startOverBtn?.addEventListener('click', async () => {
  // Unlock future context updates and hide overlay
  runLocked = false;
  if (runCompleteOverlayEl) {
    runCompleteOverlayEl.classList.add('hidden');
  }

  // Reset polling UI
  step3State = 'idle';
  step3Detail = '';
  pollingStateEl.textContent = 'Idle';
  pollingStateEl.className = 'text-slate-600';
  pollingRequestsEl.textContent = '0';
  pollingElapsedEl.textContent = '0m 0s / 5m 0s';
  pollingLastStatusEl.textContent = '—';
  pollingMessageEl.textContent = '';
  pollingMessageEl.classList.add('hidden');

  // Reset countdown state
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownArmed = false;
  countdownSectionEl.classList.add('hidden');

  // Reset form and controls
  startDateEl.disabled = false;
  nightsEl.disabled = false;
  actionBtn.classList.remove('hidden');
  stopPollingBtn.classList.add('hidden');
  initializeBookingForm();

  // Reset context to "waiting for campsite" until the user selects a new one
  currentContext = null;
  lastContextUpdatedAt = null;
  renderContext({
    url: '',
    facilityId: '',
    siteId: '',
    facilityName: '',
    location: '',
    siteName: '',
    status: 'unknown'
  });

  updateStepper();
  updateActionButton();

  // Clear logs for a clean new run (both renderer buffer and main-process buffer)
  try {
    logEntries.length = 0;
    renderLogs();
    if (window.ra?.clearLogs) {
      await window.ra.clearLogs();
    }
  } catch {
    // non-fatal if log clearing fails
  }

  // Navigate webview back to RA home to start a fresh cycle
  raView.setAttribute('src', 'https://www.reserveamerica.com/');
});

function isDashboardUrl(url) {
  return /\/explore\/my-account\/dashboard/i.test(url || '');
}

function isSigninUrl(url) {
  return /\/signin(\?|$)/i.test(url || '');
}

function base64UrlDecode(str) {
  try {
    const out = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = out.length % 4 ? 4 - (out.length % 4) : 0;
    const padded = out + '='.repeat(pad);
    return atob(padded);
  } catch {
    return '';
  }
}

function decodeJWT(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return payload || null;
  } catch {
    return null;
  }
}

function fmtTs(ts) {
  return new Date(ts).toLocaleString();
}

function renderChecks(jwtValid, a1Valid, expMs) {
  const checkIcon = `<span class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white text-[10px] leading-none">✓</span>`;
  const xIcon = `<span class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white text-[10px] leading-none">✕</span>`;
  const rows = [];

  const authLabel = jwtValid
    ? `${expMs ? `Valid until ${fmtTs(expMs)}` : 'Valid'}`
    : 'Not available or expired';
  const userLabel = a1Valid ? 'Valid' : 'Not available or invalid';

  const authValueClass = jwtValid ? 'text-slate-900' : 'text-red-600';
  const userValueClass = a1Valid ? 'text-slate-900' : 'text-red-600';

  rows.push(
    `<div class="flex items-center gap-2 text-xs">
      ${jwtValid ? checkIcon : xIcon}
        <span class="text-slate-500">Auth token:</span>
      <span class="${authValueClass}">${authLabel}</span>
    </div>`
  );
  rows.push(
    `<div class="flex items-center gap-2 text-xs">
      ${a1Valid ? checkIcon : xIcon}
        <span class="text-slate-500">User data:</span>
      <span class="${userValueClass}">${userLabel}</span>
    </div>`
  );

  authChecksEl.innerHTML = '';
  authStatusEl.innerHTML = rows.join('');
}

function validateCookies({ idToken, a1Data }) {
  // After a successful booking run we "lock" the sidebar UI so the
  // auth section doesn't flicker between signed in / signed out as
  // Reserve America mutates cookies during cart operations.
  // If we've already confirmed a logged-in state and the run is locked,
  // ignore further cookie churn.
  if (runLocked && lastAuthLoggedIn) {
    return;
  }

  const payload = idToken ? decodeJWT(idToken) : null;
  const expMs = payload?.exp ? payload.exp * 1000 : null;
  let a1Decoded = a1Data || '';
  try { a1Decoded = decodeURIComponent(a1Decoded); } catch {}
  let a1Json = null;
  try { a1Json = JSON.parse(a1Decoded); } catch {}

  // Local cookie validity
  const jwtValid = !!payload && (!expMs || expMs > Date.now());
  const a1Valid = !!a1Json;
  const cookiesLookValid = jwtValid && a1Valid;

  renderChecks(jwtValid, a1Valid, expMs);

  // Always update timestamp when we re-validate cookies
  lastAuthUpdatedAt = Date.now();

  // If cookies are not valid, we can definitively say "Not signed in"
  if (!cookiesLookValid) {
    lastAuthLoggedIn = false;
  updateStepper();
    loginBannerEl.classList.remove('hidden');
    if (loginCta) loginCta.style.display = 'block';
    if (authLiveEl) authLiveEl.textContent = 'Live auth: Not authenticated';

    // Auto-route to RA sign-in once
    if (!didRouteToLogin) {
    didRouteToLogin = true;
    const loginUrl = 'https://www.reserveamerica.com/signin';
    loginPending = true;
    raView.setAttribute('src', loginUrl);
    setTimeout(() => {
      if (!/\/signin/i.test(raView.getURL?.() || '')) {
        raView.setAttribute('src', loginUrl);
      }
    }, 50);
  }
    return;
  }

  // Cookies *look* valid; now require a live auth probe to call it "Signed in".
  lastAuthLoggedIn = false;
  updateStepper();
  if (authLiveEl) authLiveEl.textContent = 'Live auth: Checking…';

  (async () => {
    const res = await window.ra.authProbe();
    const ok = !!res?.ok;

    if (ok) {
      lastAuthLoggedIn = true;
      lastAuthUpdatedAt = Date.now();
      updateStepper();

      // On successful probe, keep checks green (cookies + server agree)
      renderChecks(jwtValid, a1Valid, expMs);

      if (authLiveEl) authLiveEl.textContent = `Live auth: OK (status ${res.status})`;

      // If we landed on dashboard post-login, send user to home
      const current = raView.getURL?.() || '';
      if (isDashboardUrl(current) || isSigninUrl(current) || current === 'about:blank') {
        raView.setAttribute('src', 'https://www.reserveamerica.com/');
      }
      loginBannerEl.classList.add('hidden');
      if (loginCta) loginCta.style.display = 'none';
    } else {
      lastAuthLoggedIn = false;
      lastAuthUpdatedAt = Date.now();
      updateStepper();

      const s = res?.status ?? 0;
      if (authLiveEl) {
        authLiveEl.textContent = s
          ? `Live auth: Not authenticated (status ${s})`
          : `Live auth: Not authenticated`;
      }

      // Ensure we prompt and route to sign-in if server-side auth is not OK
      if (!didRouteToLogin) {
        didRouteToLogin = true;
        const loginUrl = 'https://www.reserveamerica.com/signin';
        loginPending = true;
        raView.setAttribute('src', loginUrl);
        loginBannerEl.classList.remove('hidden');
        if (loginCta) loginCta.style.display = 'block';
      } else {
        loginBannerEl.classList.remove('hidden');
        if (loginCta) loginCta.style.display = 'block';
      }

      // Server rejected the cookies; treat auth/user data as invalid in the UI
      renderChecks(false, false, expMs);
    }
  })();
}

async function grabCookies() {
  const { idToken, a1Data } = await window.ra.getCookies();
  validateCookies({ idToken, a1Data });
}

// Auto-refresh cookie updates
window.ra.onCookieChanged((c) => {
  // Once a run is locked after success, we keep showing the last good
  // auth state and ignore subsequent cookie noise to avoid layout jumps.
  if (runLocked) {
    return;
  }
  // Recompute validation with fresh values by refetching.
  // Step 1 summary will reflect the latest time; no extra cookie-updated line needed.
  cookieUpdatesEl.textContent = '';
  grabCookies();
});

// Auto-grab on load
grabCookies();

// ─────────────────────────────────────────────────────────────────────────────
// Context rendering
// ─────────────────────────────────────────────────────────────────────────────
function renderContextStatus(status) {
  const statusConfig = {
    complete: { label: 'Complete', color: 'text-[#2f6b4f] bg-[#f1f7f4] border-[#d7e3db]' },
    partial: { label: 'Partial', color: 'text-[#7a4b11] bg-[#fff4d6] border-[#f0d69a]' },
    loading: { label: 'Loading', color: 'text-slate-600 bg-slate-100 border-slate-300' },
    unknown: { label: 'Unknown', color: 'text-slate-500 bg-slate-50 border-slate-200' }
  };
  const cfg = statusConfig[status] || statusConfig.unknown;
  contextStatusEl.innerHTML = `<span class="inline-flex items-center rounded-full border ${cfg.color} px-2 py-0.5 text-xs font-medium">${cfg.label}</span>`;
}

function renderContext(ctx) {
  if (!ctx) return;
  
  // Render status chip
  renderContextStatus(ctx.status);
  
  // Render fields (clear if empty to avoid stale data)
  facilityIdEl.textContent = ctx.facilityId ? `(#${ctx.facilityId})` : '';
  siteIdEl.textContent = ctx.siteId ? `(#${ctx.siteId})` : '';

  // Facility name with default placeholder
  const facilityName = ctx.facilityName || '';
  facilityNameEl.textContent = facilityName || 'Not selected';
  facilityNameEl.classList.remove('text-slate-900', 'text-slate-400');
  facilityNameEl.classList.add(facilityName ? 'text-slate-900' : 'text-slate-400');
  
  // Site name with default placeholder (remove "Site" prefix if present)
  let siteName = ctx.siteName || '';
  if (siteName && siteName.toLowerCase().startsWith('site ')) {
    siteName = siteName.substring(5); // Remove "Site " prefix
  }
  siteNameEl.textContent = siteName || 'Not selected';
  siteNameEl.classList.remove('text-slate-900', 'text-slate-400');
  siteNameEl.classList.add(siteName ? 'text-slate-900' : 'text-slate-400');
}

// Subscribe to context updates from main process
window.ra.onContextChanged((ctx) => {
  // After a successful run we lock context so the sidebar continues to show
  // the campsite that was added to cart, even as the webview navigates.
  if (runLocked) {
    return;
  }
  currentContext = ctx;
  renderContext(ctx);
  lastContextUpdatedAt = Date.now();
  updateStepper();
  updateActionButton();
});

// Manual refresh action
refreshContextBtn?.addEventListener('click', async () => {
  renderContextStatus('loading');
  // Force a real page reload so main process re-extracts context.
  // Updated context will arrive via onContextChanged above.
  raView.reload();
});

// Navigation restrictions
function isRAUrl(url) {
  try {
    const u = new URL(url);
    return /(^|\.)reserveamerica\.com$/.test(u.hostname);
  } catch { return false; }
}

raView.addEventListener('will-navigate', (e) => {
  if (!isRAUrl(e.url)) {
    e.preventDefault();
    window.ra.openExternal(e.url);
  }
});

raView.addEventListener('new-window', (e) => {
    e.preventDefault();
  if (isRAUrl(e.url)) {
    // Navigate in the same webview instead of opening new window
    raView.loadURL(e.url);
  } else {
    // Open external URLs in system browser
    window.ra.openExternal(e.url);
  }
});
// Ensure we land on sign-in if pending and not there yet
raView.addEventListener('dom-ready', async () => {
  // Inject CSS to hide scrollbars and prevent horizontal scrolling
  try {
    await raView.executeJavaScript(`
      (function() {
        const style = document.createElement('style');
        style.textContent = \`
          html, body {
            overflow-x: hidden !important;
            max-width: 100vw !important;
          }
          /* Hide scrollbars by default, show on hover/scroll */
          ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          ::-webkit-scrollbar-track {
            background: transparent;
          }
          ::-webkit-scrollbar-thumb {
            background-color: transparent;
            border-radius: 4px;
            transition: background-color 0.3s ease;
          }
          html:hover ::-webkit-scrollbar-thumb,
          body:hover ::-webkit-scrollbar-thumb {
            background-color: rgba(148, 163, 184, 0.5);
          }
          ::-webkit-scrollbar-thumb:hover {
            background-color: rgba(148, 163, 184, 0.8);
          }
          /* Firefox */
          html, body {
            scrollbar-width: thin;
            scrollbar-color: transparent transparent;
          }
          html:hover, body:hover {
            scrollbar-color: rgba(148, 163, 184, 0.5) transparent;
          }
        \`;
        document.head.appendChild(style);
      })();
    `);
  } catch (err) {
    console.warn('Failed to inject scrollbar CSS:', err);
  }

  if (loginPending) {
    const url = raView.getURL?.() || '';
    if (!/\/signin/i.test(url)) {
      raView.setAttribute('src', 'https://www.reserveamerica.com/signin');
    } else {
      loginPending = false;
    }
  }
});

// After any navigation, if RA sent us to dashboard we treat as logged in and go home
raView.addEventListener('did-navigate', () => {
  const url = raView.getURL?.() || '';
  if (isDashboardUrl(url)) {
    if (authLiveEl) authLiveEl.textContent = 'Live auth: OK (dashboard)';
    loginBannerEl.classList.add('hidden');
    if (loginCta) loginCta.style.display = 'none';
    setTimeout(() => {
      // Navigate to home after dashboard confirmation
      raView.setAttribute('src', 'https://www.reserveamerica.com/');
    }, 200);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// M6: Date validation and mode detection
// ─────────────────────────────────────────────────────────────────────────────

// Calculate when a reservation unlocks (arrival date - 9 months at 9:00 AM)
function calculateUnlockDate(arrivalDate) {
  const unlockDate = new Date(arrivalDate);
  unlockDate.setMonth(unlockDate.getMonth() - 9);
  unlockDate.setHours(9, 0, 0, 0); // 9:00 AM on unlock day
  return unlockDate;
}

// Determine booking mode based on arrival date
// Queue mode if the unlock date hasn't arrived yet, Add mode if it has
function determineBookingMode(arrivalDate) {
  if (!arrivalDate) return 'add';
  
  const now = new Date();
  const unlockDate = calculateUnlockDate(arrivalDate);
  
  // If unlock date is in the future, we need to queue
  return now < unlockDate ? 'queue' : 'add';
}

// Timezone mapping for facilities
function getFacilityTimezone(contractCode) {
  const tzMap = {
    'NY': 'America/New_York',
    'CA': 'America/Los_Angeles',
    'CO': 'America/Denver',
    'TX': 'America/Chicago'
    // Add more as needed
  };
  return tzMap[contractCode] || null; // null = use system TZ
}

// Calculate target timestamp for auto-start (08:59:55 on unlock date)
// Unlock date is: arrival date - 9 months
function calculateTargetTimestamp(arrivalDate, contractCode) {
  const tz = getFacilityTimezone(contractCode);
  
  // Calculate unlock date (arrival - 9 months)
  const unlockDate = new Date(arrivalDate);
  unlockDate.setMonth(unlockDate.getMonth() - 9);
  
  // Set to 08:59:55 on unlock date (start firing 5 seconds before 09:00:00 unlock)
  unlockDate.setHours(8, 59, 55, 0);
  
  // If we have timezone info, adjust (simplified - assumes local TZ matches or close enough)
  // Full implementation would use Intl or a library like date-fns-tz
  // For M6, we'll use system time as approximation
  
  return unlockDate.getTime();
}

// Calculate 9:00 AM timestamp on unlock date (for countdown display)
function calculateUnlockTimestamp(arrivalDate, contractCode) {
  const unlockDate = new Date(arrivalDate);
  unlockDate.setMonth(unlockDate.getMonth() - 9);
  unlockDate.setHours(9, 0, 0, 0);
  return unlockDate.getTime();
}

// Format time for display
function formatTime(date) {
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: true 
  });
}

// Format countdown clock - show days if > 24 hours, otherwise HH:MM:SS.mmm
function formatCountdown(ms) {
  if (ms < 0) return '00:00:00.000';
  
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  
  if (days > 0) {
    // Show days and hours when more than 24 hours away
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  } else {
    // Show HH:MM:SS.mmm when less than 24 hours
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking form
// ─────────────────────────────────────────────────────────────────────────────

// Helper to get date from input without timezone issues
function getStartDateAsLocal() {
  const value = startDateEl.value; // YYYY-MM-DD format
  if (!value) return null;
  
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day); // Create in local timezone
}

// Comprehensive validation function
function validateBookingForm() {
  const errors = {};
  let isValid = true;

  // Validate start date (use local timezone to avoid date shifting)
  const startDate = getStartDateAsLocal();
  if (!startDate) {
    errors.startDate = 'Start date is required';
    isValid = false;
  }

  // Validate nights (1-14)
  const nights = parseInt(nightsEl.value, 10);
  if (isNaN(nights) || nights < 1) {
    errors.nights = 'Nights must be at least 1';
    isValid = false;
  } else if (nights > 14) {
    errors.nights = 'Nights cannot exceed 14';
    isValid = false;
  }

  // Validate context (facility/site IDs present)
  if (!currentContext || !currentContext.facilityId || !currentContext.siteId) {
    errors.context = 'Navigate to a campsite page to reserve';
    isValid = false;
  }

  return { isValid, errors, startDate, nights };
}

// Display error messages
function displayErrors(errors) {
  const errorMessages = Object.values(errors).filter(Boolean);
  if (errorMessages.length > 0) {
    formErrorsEl.textContent = errorMessages.join('. ');
  } else {
    formErrorsEl.textContent = '';
  }
}

// Compute and display date range
function computeDateRange() {
  dateRangeEl.textContent = '';
  const start = getStartDateAsLocal();
  const nights = parseInt(nightsEl.value, 10);
  
  if (!start || isNaN(nights) || nights < 1) {
    return null;
  }
  
  const end = new Date(start);
  end.setDate(end.getDate() + nights);
  const fmt = (d) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const nightsText = nights === 1 ? '1 night' : `${nights} nights`;
  const formatted = `${fmt(start)} → ${fmt(end)} (${nightsText})`;
  
  dateRangeEl.textContent = formatted;
  return { start, end, nights, formatted };
}

// Update Start Polling button state based on validation
function updateActionButton() {
  const { isValid, errors, startDate } = validateBookingForm();
  
  // Determine mode
  if (startDate) {
    bookingMode = determineBookingMode(startDate);
  }
  
  // Update button label based on mode
  if (countdownArmed) {
    // Keep button disabled while armed
    actionBtn.disabled = true;
    actionBtn.textContent = 'Queue Armed';
  } else if (bookingMode === 'queue') {
    actionBtn.disabled = !isValid;
    actionBtn.textContent = 'Queue Cart';
    
    // Show mode message
    if (isValid) {
      const unlockDate = calculateUnlockDate(startDate);
      const now = new Date();
      const maxArrival = new Date(now);
      maxArrival.setMonth(maxArrival.getMonth() + 9);

      if (startDate > maxArrival) {
        bookingModeMessageEl.textContent =
          `Your arrival day is more than 9 months from today. Reserve America will not accept this yet. ` +
          `Come back on ${unlockDate.toLocaleDateString()} before 9:00 AM to queue.`;
      } else {
        bookingModeMessageEl.textContent =
          `Reservation unlocks at 9:00 AM on ${unlockDate.toLocaleDateString()}. ` +
          `We will queue this and auto-start at 08:59:55. Keep this app open and return by 09:00 to complete checkout.`;
      }
      bookingModeMessageEl.classList.remove('hidden');
    } else {
      bookingModeMessageEl.classList.add('hidden');
    }
  } else {
    actionBtn.disabled = !isValid;
    actionBtn.textContent = 'Add to Cart';
    bookingModeMessageEl.classList.add('hidden');
  }
  
  displayErrors(errors);
  
  // Update tooltip/helper text
  if (!isValid) {
    const reasons = Object.values(errors).filter(Boolean);
    actionBtn.title = reasons.join('; ');
  } else if (bookingMode === 'queue') {
    actionBtn.title = 'Probe and arm countdown to auto-start polling';
  } else {
    actionBtn.title = 'Start polling for reservation';
  }
}

// Initialize form with default values (9 months from today)
function initializeBookingForm() {
  const nineMonthsFromNow = new Date();
  nineMonthsFromNow.setMonth(nineMonthsFromNow.getMonth() + 9);
  
  // Format as YYYY-MM-DD for date input
  const dateStr = nineMonthsFromNow.toISOString().split('T')[0];
  startDateEl.value = dateStr;
  
  // Trigger initial calculations
  computeDateRange();
  updateActionButton();
}

// Event listeners for form inputs
startDateEl.addEventListener('change', () => {
  computeDateRange();
  updateActionButton();
});

nightsEl.addEventListener('input', () => {
computeDateRange();
  updateActionButton();
});

// Action button handler (Add to Cart / Queue Cart)
actionBtn?.addEventListener('click', async () => {
  const { isValid, startDate, nights } = validateBookingForm();
  
  if (!isValid) return;
  
  const formData = {
    startDate: startDate.toISOString().split('T')[0], // Format as YYYY-MM-DD
    nights
  };
  
  if (bookingMode === 'queue') {
    // Queue mode: probe first, then arm countdown
    console.log('[Queue] Probing API...');
    
    actionBtn.disabled = true;
    actionBtn.textContent = 'Probing...';
    
    const probeResult = await window.ra.probeAddItem(formData);
    
    if (!probeResult.ok) {
      alert(`Probe failed: ${probeResult.error}`);
      updateActionButton();
      return;
    }
    
    // Handle auth errors up front (expired/invalid token)
    if (probeResult.status === 401 || probeResult.status === 403) {
      const fault = probeResult.body?.faults?.[0];
      const serverMessage =
        fault?.defaultMessage ||
        fault?.messageTemplate ||
        probeResult.body?.message ||
        'Authentication error from Reserve America.';
      
      console.log('[Queue] Probe auth error, routing to login...', probeResult.status, serverMessage);
      
      // Update polling status panel
      if (pollingStateEl) pollingStateEl.textContent = 'Error';
      if (pollingStateEl) pollingStateEl.className = 'text-red-700 font-semibold';
      if (pollingRequestsEl) pollingRequestsEl.textContent = '—';
      if (pollingElapsedEl) pollingElapsedEl.textContent = '—';
      if (pollingLastStatusEl) pollingLastStatusEl.textContent = `HTTP ${probeResult.status}`;
      if (pollingMessageEl) {
        pollingMessageEl.textContent =
          serverMessage +
          '\n\nYour Reserve America session appears to have expired. We will send you to the sign-in page so you can log back in, then try "Queue Cart" again.';
        pollingMessageEl.classList.remove('hidden');
      }
      
      // Route to RA sign-in to refresh the session
      const loginUrl = 'https://www.reserveamerica.com/signin';
      didRouteToLogin = true;
      loginPending = true;
      raView.setAttribute('src', loginUrl);
      loginBannerEl.classList.remove('hidden');
      if (loginCta) loginCta.style.display = 'block';
      
      alert(`Authentication error: HTTP ${probeResult.status}\n\n${serverMessage}\n\nWe'll open the Reserve America sign-in page. After you log back in, click "Queue Cart" again.`);
      updateActionButton();
      return;
    }
    
    // Check for expected 417 error indicating "too early"
    const fault = probeResult.body?.faults?.[0];
    const errorMsg = fault?.defaultMessage || fault?.messageTemplate || '';
    
    // Distinguish between:
    // 1. 9-month rule violation (can't queue yet - come back on the right day)
    // 2. Same-day time restriction (can queue with countdown)
    const is9MonthRule = errorMsg.includes('within 9 Month');
    const isSameDayTimeRestriction = errorMsg.includes('cannot be reserved at this time') ||
                                     errorMsg.includes('try again later at');
    
    if (probeResult.status === 417 && is9MonthRule) {
      // 9-month rule violation - don't allow queuing
      console.log('[Queue] Probe failed: 9-month rule violation', errorMsg);
      
      // Update polling status to show the error
      if (pollingStateEl) pollingStateEl.textContent = 'Error';
      if (pollingStateEl) pollingStateEl.className = 'text-red-700 font-semibold';
      if (pollingRequestsEl) pollingRequestsEl.textContent = '—';
      if (pollingElapsedEl) pollingElapsedEl.textContent = '—';
      if (pollingLastStatusEl) pollingLastStatusEl.textContent = 'Too early';
      if (pollingMessageEl) {
        pollingMessageEl.textContent = errorMsg + '\n\nPlease come back the day the reservation opens before 9:00 AM to queue.';
        pollingMessageEl.classList.remove('hidden');
      }
      
      updateActionButton();
    } else if (probeResult.status === 417 && isSameDayTimeRestriction) {
      // Same-day time restriction - allow queuing with countdown
      console.log('[Queue] Probe confirmed same-day time restriction, arming countdown...', errorMsg);
      
      // Update polling status to show the probe result
      if (pollingStateEl) pollingStateEl.textContent = 'Queue Armed';
      if (pollingStateEl) pollingStateEl.className = 'text-blue-700 font-semibold';
      if (pollingRequestsEl) pollingRequestsEl.textContent = '0';
      if (pollingElapsedEl) pollingElapsedEl.textContent = '—';
      if (pollingLastStatusEl) pollingLastStatusEl.textContent = 'Too early';
      if (pollingMessageEl) {
        pollingMessageEl.textContent = errorMsg;
        pollingMessageEl.classList.remove('hidden');
      }
      
      // Extract contractCode from context
      const contractCode = currentContext?.url?.match(/\/([A-Z]{2})\/\d+\//)?.[1] || 'NY';
      
      // Arm countdown
      countdownArmed = true;
      step3State = 'queue_armed';
      step3Detail = errorMsg || '';
      updateStepper();
      // Calculate both timestamps
      countdownTargetTimestamp = calculateTargetTimestamp(startDate, contractCode); // 8:59 AM - start polling
      countdownUnlockTimestamp = calculateUnlockTimestamp(startDate, contractCode); // 9:00 AM - display countdown
      
      // Update UI
      countdownTargetEl.textContent = formatTime(new Date(countdownTargetTimestamp));
      countdownSectionEl.classList.remove('hidden');
      actionBtn.classList.add('hidden');
      stopPollingBtn.classList.remove('hidden'); // Show stop button during countdown
      updateActionButton();
      
      // Disable form inputs
      startDateEl.disabled = true;
      nightsEl.disabled = true;
      
      // Start countdown loop
      startCountdown(formData);
    } else {
      // Unexpected response - show in polling status
      const serverMessage = fault?.defaultMessage || fault?.messageTemplate || probeResult.body?.message || 'Unknown error';
      if (pollingStateEl) pollingStateEl.textContent = 'Error';
      if (pollingStateEl) pollingStateEl.className = 'text-red-700 font-semibold';
      if (pollingLastStatusEl) pollingLastStatusEl.textContent = `HTTP ${probeResult.status}`;
      if (pollingMessageEl) {
        pollingMessageEl.textContent = serverMessage;
        pollingMessageEl.classList.remove('hidden');
      }
      
      alert(`Unexpected probe response: HTTP ${probeResult.status}\n\n${serverMessage}`);
      updateActionButton();
    }
  } else {
    // Add mode: start polling immediately
    console.log('[Add] Starting polling with form data:', formData);
    
    const result = await window.ra.startPolling(formData);
    if (!result.ok) {
      alert(`Cannot start polling: ${result.error}`);
      return;
    }
    
    // Update UI
    actionBtn.classList.add('hidden');
    stopPollingBtn.classList.remove('hidden');
    
    // Disable form inputs while polling
    startDateEl.disabled = true;
    nightsEl.disabled = true;
  }
});

// Stop polling button handler
stopPollingBtn?.addEventListener('click', async () => {
  await window.ra.stopPolling();
  
  // Stop countdown if armed
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownArmed = false;
  countdownSectionEl.classList.add('hidden');
  
  // Update UI
  actionBtn.classList.remove('hidden');
  stopPollingBtn.classList.add('hidden');
  
  // Re-enable form inputs
  startDateEl.disabled = false;
  nightsEl.disabled = false;
  
  updateActionButton();
});

// M6: Countdown timer function
function startCountdown(formData) {
  countdownInterval = setInterval(async () => {
    const now = Date.now();
    const remainingToStart = countdownTargetTimestamp - now; // Time until 8:59 AM
    const remainingToUnlock = countdownUnlockTimestamp - now; // Time until 9:00 AM
    
    // Update current time clock (12-hour format with AM/PM)
    const currentTime = new Date(now);
    let hours = currentTime.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12; // Convert to 12-hour format
    const minutes = String(currentTime.getMinutes()).padStart(2, '0');
    const seconds = String(currentTime.getSeconds()).padStart(2, '0');
    const ms = String(currentTime.getMilliseconds()).padStart(3, '0');
    currentTimeClockEl.textContent = `${String(hours).padStart(2, '0')}:${minutes}:${seconds}.${ms} ${ampm}`;
    
    // Update countdown clock (show countdown to 9:00 AM unlock)
    countdownClockEl.textContent = formatCountdown(remainingToUnlock);
    
    // Check if it's time to start (8:59 AM)
    if (remainingToStart <= 0) {
      // Time to start!
      clearInterval(countdownInterval);
      countdownInterval = null;
      
      countdownStatusEl.textContent = 'Starting polling NOW!';
      
      console.log('[Queue] Target time reached, starting polling...');
      
      const result = await window.ra.startPolling(formData);
      if (!result.ok) {
        alert(`Failed to start polling: ${result.error}`);
        // Reset UI
        countdownArmed = false;
        countdownSectionEl.classList.add('hidden');
        startDateEl.disabled = false;
        nightsEl.disabled = false;
        updateActionButton();
        return;
      }
      
      // Update UI for polling
      countdownSectionEl.classList.add('hidden');
      actionBtn.classList.add('hidden');
      stopPollingBtn.classList.remove('hidden');
    } else {
      // Show countdown status (based on time to unlock, not time to start)
      const secondsRemaining = Math.floor(remainingToUnlock / 1000);
      const daysRemaining = Math.floor(secondsRemaining / 86400);
      const hoursRemaining = Math.floor((secondsRemaining % 86400) / 3600);
      const minutesRemaining = Math.floor((secondsRemaining % 3600) / 60);
      
      if (daysRemaining > 0) {
        countdownStatusEl.textContent = `Starting in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}, ${hoursRemaining} hour${hoursRemaining === 1 ? '' : 's'}...`;
      } else if (hoursRemaining > 0) {
        countdownStatusEl.textContent = `Starting in ${hoursRemaining} hour${hoursRemaining === 1 ? '' : 's'}, ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'}...`;
      } else if (minutesRemaining > 0) {
        countdownStatusEl.textContent = `Starting in ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'}...`;
      } else {
        countdownStatusEl.textContent = `Starting in ${secondsRemaining} second${secondsRemaining === 1 ? '' : 's'}...`;
      }
    }
  }, 33); // ~30fps for smooth millisecond display
}

// M6: Handle webview navigation to cart
window.ra.onNavigateToCart(() => {
  console.log('[Cart] Navigating webview to cart...');
  raView.src = 'https://www.reserveamerica.com/explore/cart/view';
});

// Subscribe to polling status updates
window.ra.onPollingStatus((status) => {
  // Update state with color coding
  pollingStateEl.textContent = status.state.charAt(0).toUpperCase() + status.state.slice(1);
  
  if (status.state === 'success') {
    pollingStateEl.className = 'text-green-700 font-semibold';
  } else if (status.state === 'error') {
    pollingStateEl.className = 'text-red-700 font-semibold';
  } else if (status.state === 'polling') {
    pollingStateEl.className = 'text-yellow-700 font-semibold';
  } else {
    pollingStateEl.className = 'text-slate-600';
  }
  
  // Update stats
  pollingRequestsEl.textContent = status.requestCount;
  
  // M7: Show elapsed with max duration
  const elapsedSec = Math.floor(status.elapsedMs / 1000);
  const maxSec = Math.floor((status.maxDurationMs || 300000) / 1000);
  const elapsedMin = Math.floor(elapsedSec / 60);
  const elapsedRemainderSec = elapsedSec % 60;
  const maxMin = Math.floor(maxSec / 60);
  const maxRemainderSec = maxSec % 60;
  
  pollingElapsedEl.textContent = `${elapsedMin}m ${elapsedRemainderSec}s / ${maxMin}m ${maxRemainderSec}s`;
  
  // Human-readable status messages with better categorization
  let statusText = '—';
  if (status.lastHttpStatus) {
    if (status.lastHttpStatus === 200) {
      statusText = 'Success';
    } else if (status.lastHttpStatus === 417) {
      // Differentiate based on the actual message
      if (status.lastMessage?.includes('9-month window')) {
        statusText = 'Use queue mode';
      } else if (status.lastMessage?.includes('Already reserved')) {
        statusText = 'Already reserved';
      } else if (status.lastMessage?.includes('Cart full')) {
        statusText = 'Cart full';
      } else {
        statusText = 'Validation error';
      }
    } else if (status.lastHttpStatus === 400) {
      statusText = 'Bad request';
    } else if (status.lastHttpStatus === 401 || status.lastHttpStatus === 403) {
      statusText = 'Auth error';
    } else if (status.lastHttpStatus === 429) {
      statusText = 'Rate limited';
    } else if (status.lastHttpStatus >= 500) {
      statusText = 'Server error';
    } else {
      statusText = `HTTP ${status.lastHttpStatus}`;
    }
  }
  pollingLastStatusEl.textContent = statusText;
  
  // Show server message if available (raw RA text), otherwise our message
  const displayMessage = status.serverMessage || status.lastMessage || '';
  pollingMessageEl.textContent = displayMessage;
  
  // Show/hide message block based on content
  if (displayMessage) {
    pollingMessageEl.classList.remove('hidden');
  } else {
    pollingMessageEl.classList.add('hidden');
  }
  
  // If stopped/error, reset UI (success is handled separately)
  if (['stopped', 'error'].includes(status.state)) {
    // Reset countdown state if armed
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    countdownArmed = false;
    countdownSectionEl.classList.add('hidden');
    
    // Show action button again, hide stop button
    actionBtn.classList.remove('hidden');
    stopPollingBtn.classList.add('hidden');
    
    // Re-enable form inputs
    startDateEl.disabled = false;
    nightsEl.disabled = false;
    
    // Update button state
    updateActionButton();
  }

  // On success, lock the current run and show overlay
  if (status.state === 'success') {
    runLocked = true;
    if (runCompleteOverlayEl) {
      runCompleteOverlayEl.classList.remove('hidden');
    }
    // Ensure controls are in a safe, non-editable state
    actionBtn.classList.add('hidden');
    stopPollingBtn.classList.add('hidden');
    startDateEl.disabled = true;
    nightsEl.disabled = true;
  }

  // Update step 3 state and logs
  step3State = status.state;
  step3Detail = status.serverMessage || status.lastMessage || '';
  updateStepper();
  addLogEntry({
    source: 'polling',
    state: status.state,
    httpStatus: status.lastHttpStatus,
    message: status.serverMessage || status.lastMessage || ''
  });
});

// Initialize form and default context on load
initializeBookingForm();
renderContext({
  url: '',
  facilityId: '',
  siteId: '',
  facilityName: '',
  location: '',
  siteName: '',
  status: 'unknown'
});

// ─────────────────────────────────────────────────────────────────────────────
// URL display (read-only, copyable)
// ─────────────────────────────────────────────────────────────────────────────

function updateUrlDisplay() {
  const url = raView.getURL?.() || '';
  if (urlDisplayEl) {
    urlDisplayEl.value = url;
  }
}

// Auto-select all text when clicked for easy copying
urlDisplayEl?.addEventListener('click', () => {
  urlDisplayEl.select();
});

// ─────────────────────────────────────────────────────────────────────────────
// Browser navigation controls
// ─────────────────────────────────────────────────────────────────────────────
function updateNavButtons() {
  if (raView.canGoBack) {
    backBtn.disabled = !raView.canGoBack();
  }
  if (raView.canGoForward) {
    forwardBtn.disabled = !raView.canGoForward();
  }
  updateUrlDisplay();
}

backBtn?.addEventListener('click', () => {
  if (raView.canGoBack && raView.canGoBack()) {
    raView.goBack();
  }
});

forwardBtn?.addEventListener('click', () => {
  if (raView.canGoForward && raView.canGoForward()) {
    raView.goForward();
  }
});

refreshBtn?.addEventListener('click', () => {
  raView.reload();
});

// Update nav button states on navigation
raView.addEventListener('did-navigate', updateNavButtons);
raView.addEventListener('did-navigate-in-page', updateNavButtons);
raView.addEventListener('dom-ready', updateNavButtons);

// ========================================
// Offline detection
// ========================================
function updateOfflineState() {
  const isOffline = !navigator.onLine;
  if (isOffline) {
    offlineStateEl.classList.remove('hidden');
    raView.classList.add('hidden');
  } else {
    offlineStateEl.classList.add('hidden');
    raView.classList.remove('hidden');
  }
}

// Listen for online/offline events
window.addEventListener('online', updateOfflineState);
window.addEventListener('offline', updateOfflineState);

// Check initial state
updateOfflineState();


