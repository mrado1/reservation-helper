# M9 Technical Design — Information Architecture & Guided Flow

## Overview
M9 refactors the **renderer information architecture** into a guided, three-step sidebar with a companion Logs view, while preserving the existing main-process behavior (auth probe, context extraction, probe/queue logic, polling worker). The goal is to treat the new layout as a **view over existing state and events**, not a new state machine.

Core technical themes:
- Introduce a **stepper view model** in the renderer driven by:
  - Cookie validation + live auth probe.
  - Context extraction events.
  - Booking form validity and mode (queue vs add).
  - Polling status events.
- Add a **Logs feed** sourced from existing probe and polling events.
- Replace the “camp” visual theme with **application-style** Tailwind classes that align with the address bar and top controls.

No changes are made to:
- Endpoints, payloads, or headers.
- Polling cadence, concurrency, or backoff.
- Countdown timing or unlock calculations.

## Components

1. **Renderer (sidebar + RA view)**
   - Stepper UI and state mapping.
   - Booking tab: wraps Auth, Context, Booking form, and Polling status inside steps 1–2–3.
   - Logs tab: lists recent probe/polling events.

2. **Preload**
   - No new capabilities required beyond what M6/M7 already expose.
   - Optionally, a small logs subscription API if we centralize log collection in main.

3. **Main Process**
   - Optional: append probe and polling events to an in-memory log buffer and broadcast updates.
   - No change to request semantics or classification logic.

## Stepper View Model

The stepper is **purely derived state**; it does not own any business logic.

### Inputs
- **Auth inputs**
  - Cookie validation results (`validateCookies` in renderer):
    - `jwtValid`, `a1Valid`.
  - Live auth probe (`window.ra.authProbe()`):
    - `{ ok: boolean, status: number }`.

- **Context inputs**
  - Context payload from `window.ra.onContextChanged(ctx)`:
    - `facilityId`, `siteId`, `facilityName`, `siteName`, `status`, `url`.

- **Booking inputs**
  - Booking form validation:
    - `validateBookingForm()` → `{ isValid, errors, startDate, nights }`.
  - Booking mode:
    - `determineBookingMode(startDate)` → `'add' | 'queue'`.

- **Polling inputs**
  - Polling status stream (`window.ra.onPollingStatus`):
    - `status.state` (`idle`, `polling`, `success`, `stopped`, `error`).
    - `status.requestCount`, `status.elapsedMs`, `status.lastHttpStatus`.
    - `status.lastMessage`, `status.serverMessage`.

### Derived Step States

Represent stepper state in renderer as:

```ts
type StepState = 'idle' | 'active' | 'complete' | 'error';

interface StepperState {
  step1: { state: StepState; message: string; detail?: string };
  step2: { state: StepState; message: string; detail?: string };
  step3: { state: StepState; message: string; detail?: string };
}
```

Derivation rules:
- **Step 1 — Sign in**
  - Complete when `jwtValid && a1Valid && authProbe.ok`.
  - Error when auth probe is non-OK (401/403) or cookies are invalid.
  - Active when not complete and the app is prompting sign-in.

- **Step 2 — Find site**
  - Complete when `ctx.facilityId && ctx.siteId` and `ctx.status === 'complete'` (DOM labels loaded).
  - Active when user is signed in but context is missing or partial.
  - Idle/error never block behavior; this is a UX indicator only.

- **Step 3 — Reserve site**
  - Active when booking form is valid and ready to start.
  - Complete when `status.state === 'success'`.
  - Error when `status.state === 'error'`.
  - “Armed” sub-state (visual only) when countdown is armed (queue mode).

The renderer updates the `StepperState` whenever any of the inputs change and re-renders the step UI (e.g., circle color, status text, detail line).

## Booking Tab Integration

The Booking tab reorganizes existing pieces into steps, but leaves their internals intact.

### Step 1 — Auth Block

Existing pieces:
- `grab` button (`window.ra.getCookies`)
- Cookie validation (`validateCookies`)
- Live auth probe (`window.ra.authProbe`)
- `loginBanner` and `loginCta` for sign-in prompt

Changes:
- Wrap these under the “Step 1: Sign in” section.
- Ensure `validateCookies` updates the stepper state:

```js
const loggedIn = jwtValid && a1Valid;
const authOk = loggedIn && lastAuthProbeOk;
stepperState.step1 = {
  state: authOk ? 'complete' : loggedIn ? 'active' : 'idle',
  message: authOk ? 'Signed in.' : 'Not signed in.',
  detail: authOk
    ? 'Cookies detected and accepted by Reserve America.'
    : 'Sign in on Reserve America in the main window.'
};
```

### Step 2 — Context Block

Existing pieces:
- Context status chip (`renderContextStatus`)
- Facility/site labels (`facilityNameEl`, `siteNameEl`, etc.)
- `window.ra.onContextChanged(ctx)` subscription

Changes:
- Embed these under “Step 2: Find site” and feed context summary into `step2.detail`.

Example mapping:

```js
const hasIds = !!(ctx.facilityId && ctx.siteId);
const complete = hasIds && ctx.status === 'complete';

stepperState.step2 = {
  state: complete ? 'complete' : hasIds ? 'active' : 'idle',
  message: complete ? 'Campsite detected.' : hasIds ? 'Campsite partially detected.' : 'Waiting for campsite.',
  detail: complete
    ? `${ctx.facilityName || 'Facility'} · ${ctx.siteName || 'Site'}`
    : hasIds
      ? `Facility #${ctx.facilityId}, Site #${ctx.siteId}`
      : 'Browse to a campsite booking page.'
};
```

### Step 3 — Booking + Polling Block

Existing pieces:
- Booking form: `startDate`, `nights`, `dateRange`, validation, mode detection.
- Queue mode behavior:
  - Probe request via `window.ra.probeAddItem`.
  - Handling of 417 “too early” cases.
  - Countdown block (`countdownSection`, timers).
- Polling:
  - Start/stop via `window.ra.startPolling`/`window.ra.stopPolling`.
  - Status subscription via `window.ra.onPollingStatus`.

Changes:
- Situate the form and polling status under “Step 3: Reserve site”.
- Stepper mapping:

```js
function updateStep3FromStatus(status) {
  let state = 'idle';
  let message = 'Not started.';
  let detail = '';

  if (status.state === 'polling') {
    state = 'active';
    message = 'Polling in progress.';
    detail = status.serverMessage || status.lastMessage || '';
  } else if (status.state === 'success') {
    state = 'complete';
    message = 'Added to cart.';
    detail = status.serverMessage || status.lastMessage || '';
  } else if (status.state === 'error') {
    state = 'error';
    message = 'Stopped with an error.';
    detail = status.serverMessage || status.lastMessage || '';
  } else if (status.state === 'stopped') {
    state = 'idle';
    message = 'Stopped.';
    detail = status.serverMessage || status.lastMessage || '';
  }

  stepperState.step3 = { state, message, detail };
}
```

The countdown “armed” state can be expressed either via a dedicated flag (e.g., `isQueueArmed`) or a special message in `detail`; it does **not** change the underlying polling logic.

## Logs View

The Logs tab is a **read-only view** over probe and polling events.

### Event Sources

- **Probe events**
  - Main process already logs probe payload and responses to the console in `ipcMain.handle('ra:probeAddItem', ...)`.
  - For the Logs tab, we can:
    - Either collect logs in main (preferred, avoids duplicating classification logic).
    - Or log in renderer when receiving results from `window.ra.probeAddItem`.

- **Polling status events**
  - Already streamed via `ra:pollingStatus` IPC and `window.ra.onPollingStatus`.
  - Logs can be derived in renderer by listening to the same stream.

### Log Entry Shape

Unifying both streams into a simple shape:

```ts
interface LogEntry {
  ts: number;           // timestamp (ms since epoch)
  source: 'probe' | 'polling';
  state?: string;       // e.g., 'polling', 'success', 'error', 'request'
  httpStatus?: number;  // if applicable
  message: string;      // concise description
}
```

### Collection Strategy (Recommended)

**Option A — Renderer-only collection**
- Pros: No new main-process code. Simpler for M9.
- Cons: Probe events must be recorded in renderer at the call site; slight duplication.

Implementation sketch:

```js
const logs = [];
const LOG_LIMIT = 200;

function addLogEntry(entry) {
  logs.push({ ...entry, ts: Date.now() });
  if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT);
  renderLogs();
}

// When probing in queue mode:
const probeResult = await window.ra.probeAddItem(formData);
addLogEntry({
  source: 'probe',
  state: 'response',
  httpStatus: probeResult.status,
  message: deriveProbeMessage(probeResult)
});

// When polling status changes:
window.ra.onPollingStatus((status) => {
  addLogEntry({
    source: 'polling',
    state: status.state,
    httpStatus: status.lastHttpStatus,
    message: status.serverMessage || status.lastMessage || status.state
  });
});
```

The Logs tab reads from `logs` and renders a chronological list (most recent at bottom or top, depending on preference).

### Rendering

Use simple, emoji-free rows:

- Time (monospace, small).
- Metadata line: `probe · HTTP 417 · error`.
- Message line: primary message from RA or classification logic.

Example HTML structure:

```html
<ul id="logsList" class="space-y-1 text-xs text-slate-700">
  <!-- entries injected via innerHTML -->
</ul>
```

## Visual & Theming Changes

M9 replaces the “camp” visual theme with a flatter, application-style design:

- **Colors**
  - Prefer neutral grays and a small accent palette.
  - Limit decorative background colors; keep most panels white/soft gray.

- **Typography**
  - Single sans-serif stack (as already configured via Tailwind).
  - Keys in key/value pairs:
    - `text-slate-500`, normal weight.
  - Values:
    - `text-slate-900`, normal/medium weight depending on emphasis.

- **Chips and indicators**
  - Status chips (e.g., context status, stepper circles) use simple border + text combinations:
    - No emoji.
    - Use color + label only.

No changes are required in main or preload for theming; all styling changes are localized to `index.html` and the renderer CSS/Tailwind classes.

## Non-Goals & Constraints

- Do **not**:
  - alter API surface of `window.ra` in breaking ways.
  - change polling cadence/concurrency behavior or success/terminal error classification.
  - introduce new persistent storage beyond what exists (cookies; optional local UI state).

- Keep the IA refactor **reversible**: if needed, the previous layout can be restored without touching main-process logic.

## Testing Strategy

### Functional Tests
- **Step 1**
  - With valid cookies and successful auth probe, verify:
    - Step 1 shows “Signed in” and detail text.
  - With invalid/expired cookies, verify:
    - Step 1 shows “Not signed in” and prompts user to log in.

- **Step 2**
  - Navigate to a campsite booking page:
    - Step 2 updates to “Campsite detected” and shows facility/site summary.
  - Navigate away:
    - Step 2 reverts to waiting state.

- **Step 3**
  - Add mode:
    - Valid form → “Add to Cart” available, step shows active.
    - On success, step shows “Added to cart.” and main view navigates to cart as before.
  - Queue mode:
    - Before unlock → “Queue Cart” available, unlock callout and countdown appear.
    - “Too early” 9‑month responses show correct guidance copy.

- **Logs**
  - Starting a probe produces a new log row with source=probe.
  - Polling run produces a series of log rows for key status transitions.
  - Logs do not explode in size (capped at ~200 entries).

### Visual Tests
- Verify:
  - No emojis appear in Booking or Logs tabs.
  - Key/value typography and colors are consistent.
  - Sidebar and address bar feel like part of the same application UI.

### Regression Tests
- Confirm all flows from previous milestones:
  - Sign in, capture cookies, detect context, run queue/add, auto-navigate to cart, and stop on error/terminal conditions.
  - Countdown and unlock timings unchanged.
  - Safety behavior from M7 (HTTP 000/429 handling, max duration) remains intact.


