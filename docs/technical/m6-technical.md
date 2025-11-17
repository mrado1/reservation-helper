# M6 Technical Design — Countdown + Auto-Start and Smart Booking Modes

## Overview
M6 introduces two booking modes based on the 9‑month rule:
- Add Now: Arrival date ≤ 9 months from today → “Add to Cart”
- Queue: Arrival date > 9 months → “Queue Cart” with preflight probe and auto‑start at 08:59:00 on the arrival date.

This milestone is renderer‑driven for countdown UI, with the main process handling network calls and success confirmation.

## Components
1. Renderer (UI/logic)
   - Date validation and button labeling
   - Queue arming and live clock
   - Start polling at target time
2. Preload (IPC surface)
   - Expose new IPC endpoints for probe and cart fetch
3. Main process
   - Preflight probe (POST additem — expect 417 with known message)
   - Start polling (existing M5), unchanged throttling/concurrency
   - Cart confirmation (GET /shoppingcart/0) after 200
   - Auto‑navigate webview to cart on confirmed success

## Time/Date Rules
- 9‑month window check
  - Compute earliest allowed arrival: today + 9 calendar months (local midnight boundary). Use a simple month-add function to avoid DST pitfalls.
  - If arrivalDate > earliestAllowed: Queue mode; else Add Now.
- Target start time
  - Facility TZ if known (map by `contractCode`); fallback to system TZ.
  - Auto‑start at 08:59:00 on arrival date in the chosen TZ.

## IPC API (new/updated)
- `auth:probe` (existing) — checks cookies valid.
- `ra:probeAddItem(formData)` (new)
  - Input: `{ startDate: 'YYYY-MM-DD', nights: number }` (context/cookies implied as in M5)
  - Behavior: Perform single POST additem
  - Expectation in Queue mode: HTTP 417 with message “Your arrival day has to be within 9 Month(s)…”
  - Returns: `{ ok: boolean, status: number, body?: any }`
- `ra:startCountdown(config)` (new)
  - Optional helper if we choose to schedule in main; for M6, countdown runs in renderer.
- `ra:getCart()` (new)
  - GET `/jaxrs-json/shoppingcart/0`
  - Returns: `{ ok: boolean, status: number, body?: any }`
- `ra:startPolling(formData)` (existing)
- `ra:stopPolling()` (existing)
- `ra:pollingStatus` (existing broadcast)

## Renderer State Machine
States:
- idle → [valid date?] → add_now_ready | queue_ready
- queue_ready + “Queue Cart” click → probing
- probing → [expected 417?] → armed | probe_failed
- armed → [time ≥ 08:59:00] → starting → polling
- polling → [success] → success_confirming → success
- polling → [stop/error/timeout] → stopped/error

Displayed UI:
- Button label: “Add to Cart” vs “Queue Cart”
- Inline validation message for >9 months
- Armed view: live clock (HH:MM:mmm) and target time line
- Polling status (existing M5)

## Success Detection (Deterministic)
On any 200 from POST additem:
1) Trigger GET `/jaxrs-json/shoppingcart/0`
2) Confirm via any of:
   - `itemsCount` increased vs previous snapshot
   - `lastChanges.addedItems` contains at least one item
   - A new item appears matching target `contractCode/facilityID/siteID`
If confirmed, broadcast success and load `https://www.reserveamerica.com/shoppingcart/0` in the webview.

## Pseudocode Sketches
Renderer (queue arm):
```
if (arrivalDate > earliestAllowed) {
  setMode('queue');
  showMessage('Beyond 9 months. Will auto-start at 08:59:00 on ...');
}

onQueueClick:
  const r = await ra.probeAddItem({ startDate, nights });
  if (r.status === 417 && /within 9 Month/.test(r.body?.faults?.[0]?.defaultMessage || '')) {
    armCountdown(targetTimestamp(08:59:00, arrivalDate, facilityTZ));
  } else {
    showError('Unexpected preflight response');
  }
```

Renderer (countdown loop):
```
setInterval(() => {
  renderClock(now());
  if (now() >= targetTs) {
    startPolling();
    clearInterval(...);
  }
}, 33); // ~30 fps for msec display
```

Main (success confirmation after 200):
```
if (status === 200) {
  const cart = await getCart();
  if (cart.itemsCount > prevItemsCount || addedItemsPresent(cart)) {
    broadcastSuccess();
    navigateWebviewToCart();
  }
}
```

## Data/Headers
- POST `/jaxrs-json/shoppingcart/0/additem`
  - Payload: `{ contractCode, facilityID, siteID, arrivalDate, units, quantity: 1, primaryItemID: null, primaryResNum: null }`
  - Headers: mirror working bash script (authorization, a1data, origin, referer, UA, cache-control/pragma)
- GET `/jaxrs-json/shoppingcart/0`
  - Headers: same cookie/auth headers

## Edge Cases
- Cookies expire during armed state → show error and unarm.
- App sleeps/clock drift → countdown recalculates next tick using `Date.now()`.
- Facility TZ unknown → fallback to system TZ (documented).

## Testing Plan
- Unit: date window calc, earliestAllowed computation, target timestamp generation (TZ aware), message toggling.
- Integration: probe returns 417 with expected message; arm transitions to start at target time; success confirmation flow after 200; cart navigation.
- Manual: verify live clock and auto‑start alignment on different days, different times.

## Limitations (M6)
- No persistence of armed state across restarts.
- TZ mapping limited (NY supported; more states later).
- Fixed auto‑start time at 08:59:00 per requirement (configurable in future).


