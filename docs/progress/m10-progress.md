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

## 🔄 In Progress

### PostHog Feature Flags Setup
- [ ] Log into PostHog dashboard
- [ ] Create `app_enabled` feature flag (global kill switch)
  - Set to `true` by default
  - Test toggling to `false` to disable app
- [ ] Create `booking_enabled` feature flag (booking kill switch)
  - Set to `true` by default
  - Test toggling to `false` to disable booking
- [ ] Verify flags are fetched correctly in app
- [ ] Test flag changes propagate to app

---

## 📋 Remaining Tasks

### Security & Privacy
- [ ] **CRITICAL**: PostHog API key is in public repo
  - Rotate key in PostHog if repo remains public long-term
  - OR move to environment variable for production
- [ ] Decide on long-term repo visibility strategy
  - Public: Easy updates, but API key exposed
  - Private: Secure, but requires notarization for updates

### Windows Build
- [ ] Set up Windows build environment (requires Wine on Mac, or Windows machine)
- [ ] Test Windows auto-updates
- [ ] Generate Windows code signing certificate (optional but recommended)

### Final Testing
- [ ] Test all analytics events fire correctly in PostHog
- [ ] Verify device IDs are consistent across sessions
- [ ] Test feature flags with various scenarios
- [ ] Test auto-update with multiple version jumps (0.2.0 → 0.4.0)
- [ ] Test app behavior when update server is unreachable

### Documentation
- [ ] Update `README.md` with auto-update information
- [ ] Document PostHog setup for future maintainers
- [ ] Document feature flag usage
- [ ] Create troubleshooting guide for update issues

---

## 🐛 Known Issues

1. **PostHog API Key Exposure**: API key is committed to repo in `config.js`
   - **Impact**: Key is visible in public repo
   - **Mitigation**: Key is scoped to project, can be rotated if needed
   - **Status**: Acceptable for now, consider environment variables for production

2. **No Notarization**: macOS builds are code signed but not notarized
   - **Impact**: Users may see Gatekeeper warnings on first launch
   - **Mitigation**: Users can right-click → Open to bypass
   - **Future**: Add notarization step for production releases

---

## 📝 Notes

- GitHub token expires: Feb 15, 2026 (90 days) - stored in 1Password
- Apple Developer ID certificate: Tied to personal account - credentials in 1Password
- PostHog project: https://app.posthog.com
- Current version: 0.4.1 (fully signed with working auto-updates)
- Repository: https://github.com/mrado1/reservation-helper (currently public)
- Auto-update check happens 3 seconds after app launch
- Feature flags are cached and fetched on app launch and before booking
- Code signing requires "Always Allow" for multiple components during build

---

## 🎯 Next Session Goals

1. ✅ ~~Make repo public temporarily~~ - DONE
2. ✅ ~~Test auto-update flow end-to-end~~ - DONE (v0.4.0 → v0.4.1 successful)
3. Set up PostHog feature flags (`app_enabled`, `booking_enabled`)
4. Test feature flag kill switches in app
5. Decide on long-term repo visibility strategy
6. Consider rotating PostHog API key or moving to env vars

