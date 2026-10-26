# Building Reservation Helper

This document explains how to build distributable versions of Reservation Helper for macOS and Windows.

## Prerequisites

1. **Node.js** (v18 or later recommended)
2. **npm** (comes with Node.js)
3. All dependencies installed: `npm install`

## Development Build

To run the app in development mode:

```bash
npm start
```

This launches Electron with hot-reloading for renderer changes.

## Production Builds

### Verified Mac ZIP for sharing

From `desktop-app`, run `npm run release:mac`. This uses the `reservation-helper` Keychain profile (or `APPLE_KEYCHAIN_PROFILE` override), builds the universal app, notarizes it, validates its signature and stapled ticket, and requires Gatekeeper acceptance. It then creates a ZIP, extracts it into a fresh directory, repeats those checks, and only copies the verified ZIP to `dist/Reservation-Helper-VERSION-universal-mac.zip`. A failed check fails the command. Each new build requires a new notarization; a previous version's ticket is not reused.


### Build for macOS (on macOS)

```bash
npm run dist:mac
```

This creates:
- `dist/Reservation Helper-0.1.0-universal.dmg` - DMG installer (universal binary for Intel + Apple Silicon)
- `dist/Reservation Helper-0.1.0-universal-mac.zip` - ZIP archive (universal binary)

**Requirements:**
- Must be run on macOS
- For signed/notarized builds, you need:
  - Apple Developer ID certificate
  - App-specific password for notarization
  - Environment variables set (see Code Signing section)

### Build for Windows (on macOS, Windows, or Linux)

```bash
npm run dist:win
```

This creates:
- `dist/Reservation Helper Setup 0.1.0.exe` - NSIS installer for Windows (x64)

**Requirements:**
- Can be built on any platform
- For signed builds, you need a Windows code signing certificate (see Code Signing section)

### Build for All Platforms

```bash
npm run dist
```

This attempts to build for macOS, Windows, and Linux. Note:
- macOS builds only work on macOS
- Windows and Linux builds work on any platform

## Code Signing

### macOS Signing & Notarization

Developer ID signing and Apple notarization are separate requirements. A valid signature alone can still be rejected by Gatekeeper as `Unnotarized Developer ID`.

The development Mac has a Developer ID Application certificate for team `H44Y4G4ZZG`. Store notarization credentials in Keychain once, using an app-specific password generated for the Apple account that belongs to that team:

```bash
xcrun notarytool store-credentials "reservation-helper" \
  --apple-id "YOUR_DEVELOPER_APPLE_ACCOUNT_EMAIL" \
  --team-id "H44Y4G4ZZG"
```

Enter the generated password at the hidden prompt. Do not put passwords in source files, shell startup files, or command arguments. Apple Developer agreements and membership must be current. Wait for confirmation that credentials were validated and saved.

From `desktop-app`, build using that profile:

```bash
APPLE_KEYCHAIN_PROFILE=reservation-helper npm run dist:mac
```

The installed electron-builder supports this environment variable and notarizes and staples the app before packaging. Without credentials it can skip notarization and still produce artifacts; do not distribute such artifacts as notarized.

Before uploading, verify the app from the actual distribution archive:

```bash
codesign --verify --deep --strict --verbose=2 "Reservation Helper.app"
xcrun stapler validate "Reservation Helper.app"
spctl --assess --type execute --verbose=4 "Reservation Helper.app"
```

Require all three checks to pass, with Gatekeeper reporting `accepted` and `source=Notarized Developer ID`. These system checks need normal host/Keychain access; restrictive sandboxes can cause misleading verification failures.

For an existing signed ZIP, submit it with `xcrun notarytool submit PATH --keychain-profile reservation-helper`. Record the submission ID, wait for `Accepted`, and inspect its log. Then staple the matching `.app` with `xcrun stapler staple`, recreate the ZIP with `ditto -c -k --sequesterRsrc --keepParent`, extract it into a fresh directory, and repeat the three checks above before replacing the public download.

### Windows Signing

To sign Windows builds:

1. **Get a code signing certificate**
   - Purchase from a Certificate Authority (DigiCert, Sectigo, etc.)
   - Or use a free certificate from SignPath.io for open source projects

2. **Install the certificate**
   - On Windows: Import the .pfx file to the Windows Certificate Store
   - On macOS/Linux: Keep the .pfx file and password secure

3. **Set environment variables**

   ```bash
   export CSC_LINK="/path/to/certificate.pfx"
   export CSC_KEY_PASSWORD="your-certificate-password"
   ```

4. **Build**

   ```bash
   npm run dist:win
   ```

## Unsigned Builds (for testing)

If you don't have signing certificates, the builds will still work but:
- **macOS**: Users will need to right-click → Open to bypass Gatekeeper on first launch
- **Windows**: SmartScreen may show warnings until the app builds reputation

To skip signing entirely, set:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
```

## Output Files

All build artifacts are created in the `dist/` directory:

```
dist/
├── Reservation Helper-0.1.0-universal.dmg          # macOS DMG installer
├── Reservation Helper-0.1.0-universal-mac.zip      # macOS ZIP archive
├── Reservation Helper Setup 0.1.0.exe              # Windows installer
└── latest-mac.yml, latest.yml                      # Auto-update metadata (if configured)
```

## Troubleshooting

### "Cannot find module 'electron'"

Run `npm install` in the desktop-app directory.

### "No identity found for signing"

Either:
- Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip signing
- Install a proper code signing certificate (see Code Signing section)

### macOS build fails on non-Mac

macOS DMG/ZIP builds require macOS. Use a Mac or a macOS VM, or skip macOS builds with:

```bash
npm run dist:win  # Windows only
```

### Windows build is slow

Cross-platform Windows builds (on macOS/Linux) use Wine and can be slow. For faster builds:
- Build on a Windows machine
- Or use a Windows VM

### "Application is damaged and can't be opened" (macOS)

This happens with unsigned builds. Users should:
1. Right-click the app → Open (instead of double-clicking)
2. Click "Open" in the security dialog

Or sign and notarize the build properly.

## Distribution

For internal testing:
1. Build the artifacts: `npm run dist:mac` and/or `npm run dist:win`
2. Upload the installers to a shared Drive folder (e.g., `/releases/v0.1.0/`)
3. Share the folder link with testers

For public release (future):
- Set up auto-update infrastructure
- Host releases on GitHub Releases or a CDN
- Configure electron-updater in the app

## Version Management

To bump the version:

1. Update `version` in `package.json`
2. Rebuild: `npm run dist:mac` or `npm run dist:win`
3. The new version will appear in the installer filenames and app metadata

Current version: **0.1.0**

## Next Steps (M8+)

- [ ] Add proper app icons (see `build/ICON_README.md`)
- [ ] Set up code signing certificates for both platforms
- [ ] Configure auto-update infrastructure
- [ ] Add crash reporting (Sentry, etc.)
- [ ] Set up CI/CD for automated builds


