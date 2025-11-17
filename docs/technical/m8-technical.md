# M8 Technical Design — Packaging & Distribution

## Overview
M8 focuses on how the Electron app is **built, signed, and shipped** for macOS and Windows. The goal is a repeatable `npm run dist` (or equivalent) that produces:

- A **signed + notarized** macOS DMG/ZIP.
- A **signed** Windows MSI/EXE installer.

This milestone does **not** change core app behavior (RA integration, polling, countdown, etc.) — it wraps the existing app into production-grade binaries.

We will use `electron-builder` as the primary packaging tool.

## Targets & Artifacts

### macOS
- Target: `dmg` (primary) and optionally `zip`.
- Minimum OS: match Electron’s supported baseline (e.g., macOS 11+).
- Signing:
  - Use an **Apple Developer ID Application** certificate.
  - Sign both the app bundle and the DMG.
- Notarization:
  - Use Apple’s notarization API via `electron-builder` (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, etc.).
  - Staple the notarization ticket to the DMG/ZIP so offline installs work.

### Windows
- Target: `nsis` or `msi` via `electron-builder`.
- Minimum OS: Windows 10+.
- Signing:
  - Use a code signing certificate (preferably EV for smoother SmartScreen).
  - Timestamp the signature via a trusted timestamp server (configured in `electron-builder`).

## electron-builder Configuration

Add/update an `electron-builder` config (either in `package.json` under `build` or in `electron-builder.yml`). Example shape:

```json
{
  "appId": "com.example.campping",
  "productName": "CampPing",
  "files": [
    "desktop-app/**/*",
    "package.json"
  ],
  "mac": {
    "target": ["dmg", "zip"],
    "category": "public.app-category.utilities",
    "icon": "assets/icon.icns",
    "hardenedRuntime": true,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist"
  },
  "dmg": {
    "background": "assets/dmg-background.png",
    "iconSize": 128,
    "contents": [
      { "x": 130, "y": 220, "type": "file" },
      { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
    ]
  },
  "win": {
    "target": ["nsis"],
    "icon": "assets/icon.ico"
  },
  "nsis": {
    "oneClick": true,
    "perMachine": false,
    "allowElevation": true,
    "allowToChangeInstallationDirectory": false
  }
}
```

> Exact values (e.g., `appId`, product name, icon paths) should align with the existing project and branding.

## Signing & Notarization Flow

### macOS

1. **Pre-requisites**
   - Apple Developer account with a **Developer ID Application** certificate.
   - Certificate installed in the macOS keychain accessible to the build user.
   - Environment variables set for notarization, e.g.:
     - `APPLE_ID` (Apple ID email).
     - `APPLE_APP_SPECIFIC_PASSWORD` (app-specific password).
     - Optionally `APPLE_TEAM_ID`.

2. **electron-builder Setup**
   - Configure `mac` section with:
     - `hardenedRuntime: true`.
     - Entitlements file with minimal sandbox permissions required by Electron.
   - Enable notarization via environment variables; `electron-builder` will:
     - Sign the `.app`.
     - Create the DMG.
     - Upload for notarization and staple the ticket.

3. **Command**
   - `npm run dist:mac` → wrapper for `electron-builder --mac dmg zip`.
   - Logs should clearly show signing and notarization steps.

4. **Validation**
   - Run `spctl -a -vv /path/to/App.app` to confirm “accepted” status.
   - Install and open on a clean macOS machine; ensure Gatekeeper allows it without manual bypass.

### Windows

1. **Pre-requisites**
   - Code signing certificate (PFX) and password.
   - Install certificate in appropriate store or reference it via `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.

2. **electron-builder Setup**
   - Configure `win` and `nsis` sections, ensuring:
     - Appropriate signing algorithm (SHA-256).
     - Timestamp server configured (defaults in `electron-builder` are fine).

3. **Command**
   - `npm run dist:win` → wrapper for `electron-builder --win nsis`.

4. **Validation**
   - Inspect signature in installer properties.
   - Run installer on a test Windows machine; verify:
     - Publisher shows correctly.
     - App appears in Start Menu and can be launched.

## Build Scripts

Add scripts to `package.json`:

```json
{
  "scripts": {
    "dist": "electron-builder -mwl",
    "dist:mac": "electron-builder --mac dmg zip",
    "dist:win": "electron-builder --win nsis"
  }
}
```

Notes:
- Local dev can still use `npm start` (unchanged).
- CI (future) can run `npm run dist` on tagged commits.

## Versioning

- Use `package.json` `version` as the single source of truth (e.g., `0.8.0-alpha.1`).
- Ensure Electron app window title / About dialog exposes `version`.
- Tag releases in git (`v0.8.0-alpha.1`) to align with produced artifacts.

## Distribution Strategy (Current)

For now this is a **small, non–mass-market tool**, so distribution is intentionally simple:

- After running `npm run dist` (or platform-specific scripts), you will:
  - Collect the macOS and Windows artifacts (DMG/ZIP + EXE/MSI).
  - Place them in a **versioned folder** in a shared Drive location, e.g.:
    - `/releases/v0.8.0/`
  - Optionally add a short `RELEASE_NOTES-v0.8.0.md` and checksum files.
- Share the Drive link directly with anyone who should test/use that build.
- There is **no public download page** or auto-update server in M8.

## Smoke Tests (Per Build)

For each platform build:

1. **Install**
   - Install on a clean VM (macOS/Windows).
   - Confirm no fatal security warnings (beyond expected early SmartScreen prompts).

2. **Launch**
   - Start the app from the normal OS launcher (Dock/Launchpad on macOS, Start Menu on Windows).
   - Confirm main window appears and loads `https://www.reserveamerica.com/`.

3. **Basic Flow**
   - Grab cookies (using existing functionality).
   - Navigate to a campsite page; confirm context detection works.
   - Start a dry-run polling session (no need to hit a live drop) to validate the polling worker runs.

4. **Uninstall**
   - Uninstall the app (drag to Trash on macOS, “Add/Remove Programs” on Windows).
   - Confirm there are no obviously leftover shortcuts or broken entries.

## Security & Privacy Considerations

- **Certificates**
  - Keep signing certificates out of the repository; provide instructions to obtain and configure them via environment variables.
- **Artifacts**
  - Ensure build artifacts do not contain dev-only secrets or environment variables.
- **Logging**
  - Existing token redaction rules apply; no change for packaging, but verify that logs are stored in OS-appropriate locations if we move them.

## Risks & Mitigations

- **Notarization failures**
  - Mitigation: Add clear logging around notarization; provide a small test script to validate credentials ahead of time.
- **Windows SmartScreen reputation**
  - Mitigation: Use consistent publisher and sign all builds; reputation will improve over time.
- **Large artifacts**
  - Mitigation: Exclude dev dependencies and unnecessary files via `files`/`extraResources` config in `electron-builder`.

## Open Questions

- Will we eventually add **auto-update** (e.g., `electron-updater`)? If yes, we will need:
  - A more formal distribution surface (e.g., GitHub Releases or a simple update server).
  - Auto-update wiring in the main process and a basic in-app “update available” UX.
- If usage grows beyond a small internal group, do we want separate “alpha” and “stable” builds, or keep a single stream?



