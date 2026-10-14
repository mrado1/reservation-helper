# Reservation Helper

Electron desktop helper for Reserve America. Version **0.4.8** repairs authentication against the current website and provides immediate and scheduled add-to-cart flows.

## Use

1. Sign into Reserve America in the embedded browser. The sidebar should say **Connected to Reserve America**.
2. Choose a campsite on the right; you do not need to select dates there. Enter or review your arrival date and number of nights on the left. Dates imported from the website do not overwrite stay fields you have edited.
3. Confirm that your dates become bookable today, choose the opening time and timezone, then click **Wait for today’s opening**. For dates already open, choose **Add now — dates are already open**. There is no future-day scheduling; a passed opening time offers Add now and never rolls to tomorrow.
4. On success, finish the required booking details and payment in the cart on the right. Adding to the cart is not a completed reservation.

Set up 3–5 minutes before reservations open and stay at your computer to finish checkout. Enter today’s exact opening time; attempts start at that time. Keep the app open and your computer awake and online. The app refreshes the session while waiting and prevents idle suspension. Closing the app cancels the schedule. Site verification or session-expiry prompts may still require your attention.

Opening time defaults to an editable 9:00 AM suggestion. The user must still confirm the campground’s release policy and confirm the opening timezone, which defaults to the computer’s current timezone. “Today” is calculated in that timezone and the scheduled date is displayed for confirmation. New York campsite pages include a link to the official release rules. The helper shows the selected opening time in the computer’s local timezone as a cross-check.

## Development

```sh
cd desktop-app
npm ci
npm start
npm test
```

Local analytics settings are optional in `desktop-app/config.js` (see `config.example.js`). Credentials for Reserve America are entered only in its website; never put them in configuration or source files. Builds generate a public-only configuration and exclude the private local file.

## Local macOS build

```sh
cd desktop-app
npx electron-builder --mac dir --universal --publish never
```

Output: `desktop-app/dist/mac-universal/Reservation Helper.app`.

A distributable download needs valid Developer ID signing **and** Apple notarization. See [build instructions](docs/technical/build.md). Do not modify an app bundle after signing it.

## Reliability

Cart requests run through the signed-in webview and its existing browser-verification integration. The worker verifies the exact campsite and dates before reporting success. Requests have timeouts, rate-limit delays and bounded retries. Stop cancels pending work and prevents old responses from changing the next run. No payment is submitted automatically.

See [0.4.8 diagnosis and validation](docs/technical/0.4.8-validation.md) for the confirmed root cause, live test results and limitations. Older milestone documents describe historical implementations.
