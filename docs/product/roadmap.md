# Product Roadmap

## Context
- scope: single‑purpose desktop app to assist booking on Reserve America (RA)
- platforms: macOS + Windows (Electron)
- constraint: user can freely use RA within the embedded browser, but navigation is restricted to RA properties only
- goal: make the “cookie capture → config → countdown → add-to-cart → checkout” flow simple and reliable

## Product Objectives
- open RA in-app, keep user signed in
- auto-read `idToken` and `a1Data` cookies (with user consent) and validate
- sidebar shows parsed campsite context (facility, site, location, site name) as the user browses RA
- form in sidebar lets user choose start date and number of nights; display derived date range
- at “drop” time (9 months ahead), aggressively add-to-cart via RA API using the user’s cookies
- show succinct status (dedup logs), not 1000 lines of spam
- on success, navigate user to cart in-app so they can checkout

Note: Technical details have been moved to `docs/technical/overview.md`.

## Feature Slices (Testable, Incremental)
1) Electron shell + RA navigation lock
   - Build app that opens `https://www.reserveamerica.com/` in a `BrowserWindow`
   - Enforce allow-listed navigation; block external domains
   - Test: Attempt to navigate to non-RA URL → blocked; RA loads normally
   - DoD: App runs on macOS/Windows; RA usable; external links blocked or opened in system browser

2) Sidebar scaffold + cookie consent/grab
   - Sidebar with “Grab cookies” and token validity display
   - Read `idToken` and `a1Data` on user action; validate (JWT exp, `a1Data` parse)
   - Auto-refresh: listen for cookie changes and update values live (no restart)
   - Auto-check on load: if cookies present and JWT valid, populate automatically (no click needed)
   - If JWT missing/invalid: navigate RA view to sign-in and prompt user to log in
   - Remove button if auto-grab is reliable; otherwise keep “Grab cookies” as a fallback
   - Test: On load with valid session → tokens appear without clicking; with no session → app navigates to sign-in and prompts; manual button (if present) still works
   - DoD: Cookies auto-detected when available; clear login prompt otherwise; nothing persisted to disk

3) Facility/site context detection
   - Parse facilityID/siteID from RA URL; enrich with location/site name from DOM
   - Test: Navigate to campsite URL → IDs/names render within 1s
   - DoD: Sidebar shows facility/site/location/site name

4) Booking form + validation
   - Inputs: start date, nights (≥1); display derived date range (nights-based)
   - Validate required fields; block invalid runs
   - Test: Bad inputs blocked; range displays correctly
   - DoD: Form cannot start unless valid

5) In-app poller (manual start)
   - Worker executes add-to-cart with bounded concurrency; cadence controls
   - Deduplicated status updates in UI
   - Test: “Start now” sends requests; “Stop” halts worker
   - DoD: Worker stable; UI responsive

6) Countdown to drop
   - Target timestamp input; visible mm:ss.ms countdown; auto-start worker
   - Test: Starts within ≤50ms skew of target
   - DoD: Reliable scheduled start

7) Safety + resilience
   - Auto-kill on HTTP `000`; simple backoff on repeated failures
   - Settings: cadence, max duration, in-flight cap
   - Test: Forced failures handled; worker exits cleanly
   - DoD: No runaway behavior; clear user control

8) Packaging + signing
   - macOS notarized DMG/ZIP; Windows signed MSI/EXE
   - Test: Fresh installs launch and function
   - DoD: Distributable installers with minimal friction

9) Information architecture + guided flow
   - Replace camp-themed sidebar with an application-style stepped flow (Sign in → Find site → Reserve site)
   - Booking tab organizes auth, context, booking form, and polling status into a 1/2/3 vertical stepper
   - Logs tab shows a concise history of probe and polling events, without emojis or noise
   - DoD: Users can complete the existing flow through the new layout; Logs tab surfaces key request history

## Future Improvements
- Cart conflict helper (fetch cart, prompt to clear items, remove via API).
- Config export/import; onboarding guide; time zone helpers; alerts/sounds.
- Optional crash reporting (local by default).
- Regional/VPS options for lower latency (with clear disclosures).

## Open Questions
- are there other RA headers/body fields that improve acceptance probability?
- do we need per-park nuances (e.g., different drop rules)?
- should we support running from a selectable region/VPS for lower latency?
- where to set safe defaults to balance success vs. rate limits?

## Acceptance Criteria (Alpha)
- user can log in to RA inside the app
- “grab cookies” confirms valid `idToken` and `a1Data`
- as user navigates to a campsite/date page, sidebar shows facility/site and friendly names
- user selects start date + nights; sees correct date range
- pressing “reserve” arms countdown and fires add-to-cart at drop; on success, auto-navigate to cart
- status panel shows clear deduped states; a log file is saved

## User Flow & Status Guidelines
- Active checkout expectation
  - User remains in-app to complete checkout after cart success.
  - The app only assists up to “added to cart” and navigates to cart automatically on success.
- Probe → Countdown → Prewarm → Open Polling
  - On “Reserve” arm, send a single probe request.
  - If response indicates “too early” (e.g., “try again at 9:00 AM” or “within 9 months”), parse target time/date and show a countdown.
  - Begin prewarm at T−60s (e.g., 8:59:00) with aggressive but bounded cadence.
  - Continue into open polling at target time.
- Minimal, deduplicated status
  - Display only when status changes (HTTP code + key message). Do not spam identical lines.
  - Show last-updated timestamp alongside the current status.
- Stop rules
  - Success (200 add-to-cart): stop and navigate to cart.
  - Terminal failure (“inventory not available”, auth invalid, etc.): stop and show reason.
  - Network blocked (HTTP 000): stop and show guidance.
  - After target time, if responses no longer include the “wait until” message and indicate failure (e.g., inventory unavailable), treat as terminal failure.


