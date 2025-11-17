# M3 Progress — Facility/Site Context Detection

Date: 2025-11-12

## Summary
Milestone 3 implements automatic context extraction from Reserve America URLs and page content. The app now parses facility and site IDs from URLs, enriches them with human-readable names from the DOM, and displays this context in the sidebar with status indicators. Context updates automatically on navigation and includes a manual refresh option. Additional features include browser navigation controls (back/forward/refresh), hot reload for development, and popup handling to keep all navigation in the same window.

## Delivered
- **Two-phase extraction**
  - Phase 1: Instant URL parsing for `facilityId` and `siteId` using regex pattern `/STATE/FACILITY_ID/SITE_ID/campsite-booking`
  - Phase 2: DOM enrichment with bounded retry (100ms, 300ms, 800ms) to extract facility name, location, and site name
- **Main process orchestration**
  - `parseIdsFromUrl(url)`: extracts IDs from URL structure
  - `extractContext(webContents, url)`: two-phase extraction with retry logic
  - `broadcastContext(ctx)`: deduplicates and broadcasts updates via IPC
  - Wired to `did-navigate`, `did-navigate-in-page`, and `dom-ready` events with 150ms debounce
- **IPC channels**
  - `ra:getContext` (invoke): returns current cached context
  - `ra:context` (broadcast): pushes context updates to renderer
- **Preload API**
  - `window.ra.getContext()`: fetch current context
  - `window.ra.onContextChanged(cb)`: subscribe to context updates
- **UI enhancements**
  - Status chip: Complete (green), Partial (yellow), Loading (gray), Unknown (gray)
  - Facility name + ID and Site name + ID displayed in sidebar (Location removed as redundant)
  - Manual "Refresh" button for on-demand context updates
  - Browser navigation bar with Back, Forward, and Reload buttons
  - Flicker avoidance: only updates when signature changes
  - Clear stale values when navigating away from campsite pages
  - Auto-strips "Site" prefix from site names to avoid duplication
- **Navigation & Popup Handling**
  - `setWindowOpenHandler` in main process intercepts popup attempts
  - All RA links navigate in same window (no popups)
  - External links open in system browser
  - Webview has `allowpopups` for RA functionality but popups are redirected to same window
- **Development Features**
  - Hot reload: automatically reloads renderer on file changes (HTML/JS/CSS)
  - File watcher monitors `renderer/` directory
  - Console notifications for main process file changes (requires manual restart)
  - 100ms debounce prevents multiple reloads on rapid saves
- **Resilience**
  - Safe error handling for `executeJavaScript` failures
  - Deduplication prevents UI spam
  - Layered DOM selectors for robustness across RA page variants
  - Unknown state after retries if no context found

## Key Files/Entrypoints
- `desktop-app/main.js` (338 lines)
  - Lines 6-138: Context extraction state, parsing, DOM enrichment, dedup, broadcast
  - Lines 165-202: Webview event wiring with debounce and popup handling
  - Lines 207-243: Hot reload file watcher for development
  - Lines 246-258: IPC handler for `ra:getContext`
- `desktop-app/preload.js`
  - Lines 14-20: Expose `getContext()` and `onContextChanged(cb)` to renderer
- `desktop-app/renderer/index.html` (121 lines)
  - Lines 62-78: Context section UI with status chip and refresh button
  - Lines 98-114: Browser navigation bar (back/forward/reload buttons)
  - Line 115: Webview with `allowpopups` and top offset for nav bar
- `desktop-app/renderer/renderer.js` (322 lines)
  - Lines 9-14: Context UI element references
  - Lines 167-197: Context rendering logic with "Site" prefix stripping
  - Lines 200-209: Context event subscriptions
  - Lines 219-231: New-window event handler for popup prevention
  - Lines 287-315: Browser navigation controls (back/forward/reload)

## DOM Selectors Used
Layered fallback selectors for resilience:
- **Facility name**: `h1[data-qa="facility-title"]`, `h1`, `[data-qa="facility-name"]`, `.facility-name`, `h1.facility-title`
- **Location**: `[data-qa="facility-location"]`, `.facility-location`, `nav[aria-label="breadcrumb"] li:last-child`, `.breadcrumb li:last-child`, `.subtitle` (extracted but not displayed in UI)
- **Site name**: `[data-qa="site-name"]`, `h2[data-qa="site-title"]`, `.site-name`, `.campsite-details h2`, `h2`

These selectors are defensive and may need adjustment based on actual RA DOM structure. Site names have "Site " prefix automatically stripped to avoid duplication in display.

## How to Test (Manual)
1) Start app: `cd desktop-app && npm start`
2) Log in to Reserve America
3) Navigate to a campsite booking page (e.g., from README example)
   - Context section should show:
     - Status: "Partial" immediately, then "Complete" within ~1s
     - Facility name and ID (e.g., "Glen Island (Lake George Is.), New York – Campsite (#140)")
     - Site name and ID (e.g., "BB011, Loop Big Burnt (#245729)")
4) Test browser navigation:
   - Click Back button → goes to previous page
   - Click Forward button → goes forward in history
   - Click Reload button → refreshes current page
   - Buttons disable/enable based on history availability
5) Test popup handling:
   - Click any RA link that would open in new window → opens in same window
6) Navigate to non-campsite page (e.g., home, explore)
   - Status: "Unknown"
   - Fields cleared or show "—"
7) Click context "Refresh" button
   - Status briefly shows "Loading", then updates
8) Test hot reload (development):
   - Edit `renderer/renderer.js` or `renderer/index.html`
   - Save file → app automatically reloads without losing login
   - Check console for "[Hot Reload] Detected change..." message

## Automated Tests
- URL parsing tests (5 test cases, all passing ✓)
  - Valid campsite URLs (README example, alternate state)
  - Non-campsite URLs (home, sign-in, explore)
  - Run with: `cd desktop-app && node test-context.js` (file was created but later removed)

## Notes / Rationale
- Two-phase extraction provides instant feedback (IDs) while waiting for DOM labels
- Bounded retry (3 attempts) balances responsiveness vs. DOM load timing
- Deduplication signature prevents UI flicker on redundant updates
- 150ms debounce on navigation events avoids excessive extraction calls during SPA transitions
- Main process orchestration keeps renderer simple and avoids executeJavaScript complexity in renderer
- Status chips provide clear visual feedback on extraction state
- Location field removed from UI as it's redundant with facility name
- "Site" prefix stripped from site names to avoid "Site: Site BB011" duplication
- Hot reload keeps login session intact (only reloads renderer, not main process)
- Browser navigation controls improve UX for exploring RA within the app
- Popup handling via `setWindowOpenHandler` ensures single-window experience

## Known Limitations
- DOM selectors are best-effort; RA may change their markup
- Some RA pages may have delayed DOM rendering beyond our 800ms final retry
- Manual refresh available as fallback if auto-extraction misses content

## Follow-ups / Handoff to M4
- Add booking form validation (M4: Roadmap Slice 4)
- Wire context into booking API calls (facility/site IDs)
- Consider caching context per URL to avoid re-extraction on back/forward navigation
- Monitor RA DOM changes and update selectors as needed
- Optional: add "Copy IDs" action for user convenience


