# M2 Technical Design — Sidebar + Cookie Consent/Grab

## Scope (M2)
- Sidebar “Auth” block with explicit cookie grab and validation.
- Auto‑refresh when `idToken` or `a1Data` changes.
- No countdown/polling/worker yet.

## Architecture
- Main process
  - IPC: `getCookies` (reads RA cookies), broadcast `cookieChanged` on Electron cookie events.
  - Security: contextIsolation true; minimal IPC surface; no persistence of cookie values.
- Preload
  - Exposes `getCookies()` and `onCookieChanged(cb)` to renderer.
- Renderer
  - Auth UI: “Grab cookies”, status chips, expiry, parse state, login CTA/banner.
  - Validation logic runs client‑side; no sensitive values displayed.

## Cookie Read/Watch
```js
// main
ipcMain.handle('getCookies', async () => {
  const cookies = await session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
  return {
    idToken: cookies.find(c => c.name === 'idToken')?.value || '',
    a1Data:  cookies.find(c => c.name === 'a1Data')?.value || ''
  };
});
session.defaultSession.cookies.on('changed', (_e, cookie) => {
  if ((cookie.domain || '').includes('reserveamerica.com') &&
      (cookie.name === 'idToken' || cookie.name === 'a1Data')) {
    win.webContents.send('cookieChanged', { name: cookie.name });
  }
});
```

## Auto-check on Load and Login Routing
- On renderer init, call `getCookies()` automatically.
- If `idToken` is present and not expired:
  - Render valid chips and expiry; hide manual “Grab cookies” button.
- If `idToken` is missing/expired:
  - Navigate the embedded RA view to the sign-in page (same window).
  - Show a banner/CTA prompting the user to log in.
  - Keep the button only as fallback; prefer auto-grab by default.

## Validation
- JWT:
  - Split by “.” → decode payload (base64url) → JSON → check `exp` against `Date.now()`.
  - Display: “valid/invalid” + expiry timestamp; never show token text.
- a1Data:
  - Attempt `decodeURIComponent` then `JSON.parse`.
  - Display: “valid JSON/invalid” + length; no raw value.

## UX
- Chips for JWT/a1Data state (green/camp pine for valid, soft red for invalid).
- Login banner/CTA when invalid/missing; hides on valid state.
- Tailwind utilities for consistent spacing, typography, and focus rings.

## Security & Privacy
- Do not persist cookies or logs containing tokens.
- Avoid rendering tokens; show only metadata.

## Acceptance Tests
- After clicking “Grab cookies,” JWT + a1Data statuses update with correct expiry/length.
- Modifying RA session (logout/login) triggers auto‑refresh within ~1s.
- Invalid/missing cookies display the login banner and red chips.

## Risks
- Cookie change event timing varies; manual refresh remains available.
- JWT payload formats may vary; decoder is defensive and falls back gracefully.


