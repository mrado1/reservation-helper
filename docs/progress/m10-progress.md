# Milestone 10 Progress

**Goal**: Implement auto-updates, analytics, feature flags, and repository migration

**Status**: In Progress

---

## ✅ Completed Tasks

### 1. Repository Migration
- [x] Created new repository: `mrado1/reservation-helper`
- [x] Migrated all code from `SmokeStudio/camping-thing`
- [x] Updated all internal references and documentation
- [x] Pushed clean history to new remote

### 2. Configuration Setup
- [x] Created `config.js` for PostHog API key and settings
- [x] Created `config.example.js` template for repo
- [x] Added PostHog API key to config
- [x] Included `config.js` in build files (was causing crash)

### 3. Auto-Update Implementation
- [x] Installed `electron-updater` package
- [x] Configured `autoUpdater` in `main.js`
- [x] Added GitHub publish configuration to `package.json`
- [x] Created IPC handlers for update checking and installation
- [x] Added update event listeners (checking, available, progress, downloaded)
- [x] Set up auto-check on app launch (3 second delay)
- [x] Configured GitHub Releases as update provider

### 4. PostHog Analytics Integration
- [x] Installed `posthog-node` package
- [x] Installed `node-machine-id` for anonymous device tracking
- [x] Initialized PostHog client in `main.js`
- [x] Created `trackEvent` helper function
- [x] Implemented analytics events:
  - `app_launched` - fires on every app start
  - `booking_started` - fires when user starts polling
  - `booking_success` - fires when item added to cart
  - `booking_error` - fires on various error conditions
- [x] Added device ID generation for user tracking
- [x] Added `posthog.shutdown()` on app quit

### 5. Feature Flags Implementation
- [x] Implemented `fetchFeatureFlags` function using PostHog
- [x] Created `checkAppEnabled` function for global kill switch
- [x] Added `app_enabled` flag check on app launch
- [x] Added `booking_enabled` flag check before polling starts
- [x] Created IPC handler for renderer to fetch flags
- [x] Added feature flag caching

### 6. Build & Distribution
- [x] Generated GitHub Personal Access Token (90 day expiration)
- [x] Set up `GH_TOKEN` environment variable
- [x] Bumped version from 0.2.0 to 0.3.0
- [x] Built and published v0.3.0 to GitHub Releases
- [x] Verified DMG and ZIP files uploaded
- [x] Verified `latest-mac.yml` manifest uploaded

---

## ✅ Completed (Continued)

### Code Signing & Auto-Update Testing
- [x] Made repository public for auto-update testing
- [x] Discovered auto-updates require code signing on macOS
- [x] Created Developer ID Application certificate (Apple Developer account)
- [x] Installed code signing certificate and intermediate CA
- [x] Added hardenedRuntime and entitlements to build config
- [x] Built and published signed v0.4.0
- [x] Built and published signed v0.4.1
- [x] **Successfully tested auto-update**: v0.4.0 → v0.4.1
  - Update detection: ✅ Working
  - Download: ✅ Working
  - Installation: ✅ Working
  - Restart: ✅ Working
- [x] Fixed app display name in macOS menu bar

**Note**: Code signing certificate is tied to personal Apple Developer account (credentials in 1Password).

### Tailwind CSS Bundling (v0.4.6)
- [x] Fixed broken UI in packaged app (Tailwind CDN was failing)
- [x] Downgraded from Tailwind v4 to v3 for compatibility
- [x] Created `renderer/input.css` and `tailwind.config.js`
- [x] Built and bundled `renderer/output.css` locally
- [x] Updated `index.html` to use local CSS instead of CDN
- [x] Removed CSP restrictions for `cdn.tailwindcss.com`
- [x] Verified styling works in both dev and packaged app
- [x] Added Tailwind files to git (input.css, output.css, tailwind.config.js)

### Offline Detection (v0.4.6)
- [x] Added offline state detection using `navigator.onLine`
- [x] Created minimal offline empty state UI (16px icon + text)
- [x] Added event listeners for `online`/`offline` events
- [x] Hides webview and shows "Offline" message when disconnected
- [x] Automatically restores webview when connection returns

## 🔄 In Progress

### PostHog Feature Flags Setup
- [x] Created `app_enabled` feature flag (global kill switch) in PostHog
  - Defaults to `true` (app enabled)
  - Toggling to `false` shows \"App Unavailable\" dialog and quits on launch
- [x] Created `booking_enabled` feature flag (booking kill switch)
  - Defaults to `true` (booking allowed)
  - Toggling to `false` prevents booking (kill switch)
- [x] Wired flags using `posthog-node` server-side SDK (`getAllFlags(deviceId)`)
- [x] Verified flags are fetched correctly in app (see main.log)
- [x] Verified flag changes propagate to app without rebuild

---

## 📋 Remaining Tasks

### Security & Privacy
- [x] Removed hardcoded PostHog API keys from committed code
- [x] Moved keys into `.env` / local `config.js` (POSTHOG_API_KEY, POSTHOG_PERSONAL_API_KEY)
- [x] Rotated PostHog keys after previous exposure
- [ ] Decide on long-term repo visibility strategy
  - Public: Easy updates, but API key exposed
  - Private: Secure, but requires notarization for updates

### Windows Build
- [ ] Set up Windows build environment on a real Windows 10+ x64 machine
- [ ] Build NSIS installer via `npm run dist:win` on Windows
- [ ] (Optional) Add Windows code signing certificate and SmartScreen-friendly signing

### Final Testing
- [ ] Test all analytics events fire correctly in PostHog (note: `booking_error` still TODO)
- [ ] Verify device IDs are consistent across sessions
- [x] Test feature flags with various scenarios (app and booking kill switches)
- [x] Test auto-update with multiple version jumps (0.2.0 → 0.4.3)
- [ ] Test app behavior when update server is unreachable

### Documentation
- [ ] Update `README.md` with auto-update information
- [ ] Document PostHog setup for future maintainers
- [ ] Document feature flag usage
- [ ] Create troubleshooting guide for update issues

---

## 🐛 Known Issues

1. **PostHog API Key Exposure (historical)**: API key was previously committed in `config.js`
   - **Impact**: Key existed in Git history while repo was public
   - **Mitigation**: Keys now loaded from `.env` only; consider rotation
   - **Status**: Acceptable for internal usage, revisit before broader distribution

2. **No Notarization**: macOS builds are code signed but not notarized
   - **Impact**: Users may see Gatekeeper warnings on first launch
   - **Mitigation**: Users can right-click → Open to bypass
   - **Future**: Add notarization step for production releases

---

## 📝 Notes

- GitHub token expires: Feb 15, 2026 (90 days) - stored in 1Password and `~/.zshrc`
- Apple Developer ID certificate: Tied to personal account - credentials in 1Password
- PostHog project: https://app.posthog.com
- Current version: 0.4.7 (auth state freeze after success, bundled Tailwind CSS, offline detection)
- Repository: https://github.com/mrado1/reservation-helper (currently public)
- Auto-update check happens 3 seconds after app launch
- Feature flags are cached and fetched on app launch and before booking
- Code signing requires "Always Allow" for multiple components during build
- **Tailwind CSS**: Now bundled locally (v3) instead of CDN for offline support

---

## 🎯 Next Session Goals

1. ✅ ~~Make repo public temporarily~~ - DONE
2. ✅ ~~Test auto-update flow end-to-end~~ - DONE (v0.4.0 → v0.4.1 successful)
3. ✅ ~~Set up PostHog feature flags (`app_enabled`, `booking_enabled`)~~
4. ✅ ~~Test feature flag kill switches in app~~
5. ✅ ~~Fix broken UI in packaged app (bundle Tailwind CSS)~~ - DONE (v0.4.6)
6. ✅ ~~Add offline detection~~ - DONE (v0.4.6)
7. Build and publish v0.4.6 to GitHub Releases
8. Decide on long-term repo visibility strategy
9. Consider rotating PostHog API key before external distribution

