# M1 Progress — Reserve America Helper

Date: 2025-11-11

## Summary
We delivered the M1 desktop experience that embeds Reserve America (RA) in an Electron shell with a polished, “camp” aesthetic sidebar. Users can log in inside the app, auto‑grab/validate session cookies, see current page context, and configure a booking plan (start date + nights) with a derived date range and validation. No booking API calls yet (that’s M2).

## What’s Included (Delivered)
- Electron shell with RA webview
  - RA opens in-app; external domains open in the system browser
  - Secure defaults: contextIsolation on, preload with minimal API surface
- Sidebar (Tailwind, refined IA/typography, camp palette)
  - Auth block: “Grab cookies”, live JWT/a1Data status chips (green/red), expiry display, auto‑refresh on cookie change
  - Auto-detect login banner + “Go to login” CTA; hides when session becomes valid
  - Current Page: URL, facilityID, siteID; best‑effort location/site names from DOM (fallback to IDs)
  - Booking Form: start date + nights with nights‑based date range and validation
- Auto-refresh cookies
  - Listens to Electron cookie change events and updates UI without restart

## What’s Explicitly Not Included (M1)
- Countdown/prewarm engine and add‑to‑cart polling
- Success navigation to cart
- Packaging/signing for distribution (dev run only)
- Persistent storage of tokens (memory only)

## How to Run
1) cd desktop-app
2) npm install
3) npm start
4) Log in to RA in the right pane; the sidebar will auto‑detect your session and show green checks for JWT and a1Data.

## Manual Test Checklist
- App shell
  - RA loads in the right pane
  - Navigating to a non‑RA domain opens the system browser (blocked in‑app)
- Auth
  - Click “Grab cookies” → JWT expiry and a1Data parse status display
  - After login, chips turn green and the gold login banner hides automatically
  - Changing cookies (logout/login) updates the status within ~1s
- Context
  - On a campsite/date page, facilityID/siteID populate
  - If available, location/site name appears from page content; otherwise IDs still show
- Form
  - Enter start date + nights → derived date range is correct
  - Invalid inputs show clear inline errors

## Known Issues / Notes
- Third‑party ad/cookie‑sync requests in the RA site can emit console noise (cert/blocked). Harmless; we can add a targeted network filter in M2 if needed.
- DOM selectors for location/site names are best‑effort and may change; IDs still populate reliably.
- Time display uses local system timezone; clock skew isn’t surfaced yet (address in M2).
- No packaging/signing; this milestone is intended for developer runs only.

## Technical Highlights
- Tailwind‑based layout and typography with a “camp” palette (warm cream, pine, rust, parchment dividers)
- Renderer auto‑grabs cookies on load and subscribes to change events
- Minimal IPC surface (getCookies + cookieChanged stream)

## Risks
- RA page structure changes could break name extraction; fallback to IDs mitigates UX impact
- Users with unsynced system clocks may misinterpret timing in future milestones (we’ll add skew guidance in M2)

## M2 Plan (Next Up)
- Countdown + prewarm engine (probe → countdown → T−60s prewarm → open polling)
- Worker‑based add‑to‑cart with bounded concurrency (configurable cadence), deduped status feed
- Stop rules: SUCCESS (200 → navigate to cart), FAIL (inventory unavailable), BLOCKED (HTTP 000 auto‑stop)
- Power management: prevent sleep during prewarm/polling
- Settings: cadence, max duration, in‑flight cap
- Logging: token‑redacted, timestamped files; compact UI status with change‑only updates
- Optional: targeted network filters for known third‑party noise in the webview

## Open Questions
- Any additional RA headers/body nuances we should mirror before M2?
- Preferred defaults for cadence (e.g., 10–50ms) and in‑flight cap (10–20)?
- Do we want a cart conflict helper (list/remove items) in M2 or push to M3?


