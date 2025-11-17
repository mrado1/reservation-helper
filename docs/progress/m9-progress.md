# M9 Progress — Information Architecture & Guided Flow

Date: 2025-11-16

## Summary
Milestone 9 refactors the desktop app’s UI into a **guided, three-step flow** with a dedicated Logs view, while preserving the underlying RA booking behavior. The old “camp” themed sidebar is replaced by an application-style layout that groups Auth, Context, Booking form, and Polling status into a 1–2–3 stepper under a `Booking` tab, with a `Logs` tab showing a developer-friendly request/response history. The goal is to make the flow legible at a glance (“Where am I? What’s next?”) without introducing new backend state.

## Delivered

- **Stepped Booking layout (1–2–3 flow)**
  - New 3-step vertical flow in the sidebar:
    1. **Sign in** — auth state and cookie validity.
    2. **Find site** — facility/site context from the current RA page.
    3. **Reserve site** — booking form + polling state.
  - Step circles visually reflect state (idle/active/complete/error) and are styled as app-like badges rather than themed chips.
  - Each step contains:
    - Header + inline info icon with a hover tooltip (no long instructional body copy).
    - Status line (`Status:` key in gray, value in black).
    - Data line(s) presenting the most relevant fields for that step.

- **Step 1 — Auth integration**
  - Auth block reflects existing cookie + `authProbe` logic:
    - Step status: `Signed in` / `Not signed in`.
    - Summary: `Cookies detected and accepted by Reserve America at {time}.`
  - JWT/a1Data detail rows:
    - `Auth token: Valid (Expires 11/16/2025, 5:49:30 PM)` with:
      - Green circular check when valid.
      - Value in black, “Expires …” fragment in gray.
      - Light gray fallback (`Not available or expired`) when missing.
    - `User data: Valid` with the same green check, or a light gray fallback when missing/invalid.
  - Cookie-change events re-validate and update the summary time but do not add extra noisy lines.

- **Step 2 — Context integration**
  - Context section wired to `onContextChanged`:
    - Status values: `Waiting for campsite`, `Campsite partially detected`, `Campsite detected`.
    - Facility/Site rows:
      - Default values: `Not selected` (light gray) before any context is known.
      - When populated: facility/site names in black plus their IDs (e.g., `(#140)`).
    - “Find site” tooltip explains that the user should open a campsite booking page, but the main body avoids redundant instructional text.
  - `Refresh` button lives in the header row for Step 2 (right-aligned) and forces a reload/context re-extraction when clicked.

- **Step 3 — Booking + Polling integration**
  - Booking form and polling status are fully embedded into Step 3:
    - Start date + nights inputs with date range display.
    - Queue vs Add behavior preserved:
      - Queue mode shows a callout describing unlock time and auto-start behavior.
      - If the start date is > 9 months out, UI explains that RA will not accept the reservation yet and instructs the user to come back on the correct day.
    - Polling status shows:
      - State, requests, elapsed, last status (with emoji-free labels).
      - Last message from RA (hidden container when empty, visible only when populated).
  - Step 3 status line mirrors the worker state:
    - `Not started`, `Queue armed`, `Polling in progress`, `Added to cart`, `Stopped with an error`, `Stopped`.
  - Countdown flow (queue mode) is unchanged functionally; the visual treatment is flattened to match the rest of the UI.
  - On success:
    - The RA webview navigates to the cart, but the sidebar context remains locked on the campsite that was just added.
    - A light “Run complete” overlay appears over the Booking pane with a `Start over` button.
    - `Start over` resets the form, countdown, and polling state, clears logs, returns context to “waiting for campsite”, and navigates the RA webview back to the homepage for a fresh run.

- **Booking / Logs tab structure**
  - Sidebar now has two top tabs:
    - `Booking` (default) — contains the full 3-step flow and controls.
    - `Logs` — a scrolling developer log for probes and polling.
  - Tabs styled as app chrome:
    - Active tab: `border-b-2` with dark text.
    - Inactive tab: transparent border, muted text, subtle hover border.
  - Header + tabs in the sidebar are sticky; only the `Booking` / `Logs` pane content scrolls.

- **Logs tab backed by main-process log buffer**
  - Main process maintains an in-memory log buffer (`LOG_LIMIT` ~1000 entries).
  - Events recorded:
    - Probes (`ra:probeAddItem` requests and responses, including errors).
    - Polling status transitions (state, HTTP code, key message).
    - Every polling `additem` attempt (per-request request/response logging).
  - IPC surface:
    - `ra:getLogs` to fetch current log snapshot.
    - `ra:logsUpdated` broadcast on each change.
    - `ra:clearLogs` to clear the buffer and notify renderers.
  - Renderer:
    - Initializes from `getLogs`, then keeps in sync via `onLogsUpdated`.
    - Renders each row as:
      - Time (mono), metadata (`Request` / `Response` + HTTP status label), and a single-line message (truncated with tooltip).
    - Every HTTP status is shown as a color-coded pill:
      - `HTTP 200` in green, `HTTP 0` in amber, `HTTP 4xx` in orange, `HTTP 5xx` in red, and all others in a neutral pill.
    - A `Clear logs` button in the Logs header clears history for the current app session, and `Start over` also clears logs when beginning a new run.
  - No emojis; messages mirror the human-readable strings already used in the sidebar.

- **Visual clean-up and key/value consistency**
  - Removed the previous “camp” theme: no green/cream backgrounds, no decorative icons, neutral gray/white palette.
  - Header simplified to just the product name (no logo/triangle).
  - All key/value lockups standardized:
    - Keys in muted gray.
    - Values in black (or lighter gray for defaults).
  - Emojis removed from all sidebar copy and from most console/log strings (replaced with plain English labels).

## Key Files / Entrypoints

- `desktop-app/renderer/index.html`
  - New `Booking` / `Logs` tab structure.
  - Stepper markup for Step 1/2/3.
  - Integrated Auth, Context, Booking form, Countdown, and Polling status into the stepper.
  - Logs tab layout (sticky header with `Clear logs`, scrollable list underneath).

- `desktop-app/renderer/renderer.js`
  - Stepper state (`lastAuthLoggedIn`, `lastContextUpdatedAt`, `step3State`, `step3Detail`) and `updateStepper()` mapping from underlying auth/context/polling signals.
  - Auth rendering (`renderChecks`, consolidated cookie summary).
  - Context rendering with default placeholders (`Facility/Site: Not selected`) and gray/black value styling.
  - Polling status subscription mapping into both the Polling Status UI and Step 3, including success locking behavior and the “Run complete / Start over” overlay.
  - Logs rendering for per-request `Request` / `Response` entries, including color-coded HTTP status pills and clear-logs behavior.

- `desktop-app/main.js`
  - Log buffer implementation and `addLogEntry()` helper.
  - Logging of probe responses and errors, polling status events, and every polling `additem` request/response into the buffer.
  - `ra:getLogs`, `ra:clearLogs` IPC handlers and `ra:logsUpdated` broadcasts.
  - Emoji-free status messages (e.g., “Rate limited: pausing … seconds” instead of emoji labels).

- `desktop-app/preload.js`
  - New `window.ra.getLogs()`, `window.ra.onLogsUpdated()`, and `window.ra.clearLogs()` APIs exposed to the renderer.

## Status vs. Product Spec

From `docs/product/m9.md`:

| Requirement | Status |
|------------|--------|
| Replace camp-themed sidebar with app-style 1–2–3 flow | **Done** |
| Stepper wraps existing Auth, Context, Booking, Polling | **Done** |
| Booking tab organizes flow into vertically stepped layout | **Done** |
| Logs tab shows concise probe/polling history | **Done** |
| Copy uses consistent key/value styling, no emojis | **Done** |
| Queue/Add behavior and countdown preserved | **Done** |
| 9‑month rule and daily unlock messaging updated | **Done** (wording tuned iteratively during testing) |
| No new backend logic; pure IA/UX refactor | **Done** (all changes stay in renderer + log surfacing) |

## How to Smoke Test M9

1. **Layout & navigation**
   - Launch the desktop app.
   - Verify:
     - Sidebar shows `Booking` and `Logs` tabs.
     - Booking tab displays 3 steps; Logs tab shows the empty-state copy.
   - Confirm address bar + RA webview fill the right-hand viewport without extra scroll past the webview.

2. **Step 1 — Sign in**
   - With no RA session:
     - Step 1 shows `Status: Not signed in`.
     - Auth rows show gray defaults (no green checks).
   - Log in on RA inside the app:
     - After cookies are detected and `authProbe` passes, Step 1 updates to `Signed in`.
     - “Cookies detected and accepted by Reserve America at …” appears with the current time.
     - Auth rows show green check circles and “Valid (Expires …)” text.

3. **Step 2 — Find site**
   - On initial load:
     - Facility/Site values read `Not selected` in light gray.
   - Navigate to a campsite booking page:
     - Step 2 status becomes `Campsite detected` (or partially detected).
     - Facility/Site rows populate with names and IDs; values turn black.
     - Refresh button reloads and re-runs context detection.

4. **Step 3 — Reserve site**
   - Fill a valid start date/nights and confirm:
     - Date range shows correctly.
     - Button label flips to `Queue Cart` or `Add to Cart` based on unlock logic.
   - In queue mode (before unlock):
     - Click `Queue Cart`:
       - Probe runs.
       - If “too early” but same-day, countdown arms and Step 3 status becomes `Queue armed`.
       - If 9‑month rule violation, Step 3 shows an appropriate error and explains to come back on the correct day.
   - In add mode (window open):
     - `Add to Cart` behaves as in prior milestones; on success, Step 3 shows `Added to cart`, the RA view navigates to the cart, the sidebar context remains locked on the successful campsite, and the “Run complete” overlay appears with a `Start over` button.

5. **Logs tab**
   - While probing/polling, switch to `Logs` tab:
     - Entries appear for probes and per-request polling activity with timestamps, HTTP-coded pills, and concise messages.
     - `Clear logs` empties the current session history; `Start over` also clears logs before beginning a fresh run.

## Known Gaps / Follow-ups

- Logs are in-memory only (no disk persistence); exporting log files remains a future enhancement.
- Step copy and typography have been tuned for clarity, but may still benefit from additional UX passes once more real-world usage data is available.
- The design assumes a single active run; multi-site or multi-run UX would require further IA work on top of this foundation.


