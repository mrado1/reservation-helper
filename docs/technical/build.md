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

To create signed and notarized macOS builds that don't trigger Gatekeeper warnings:

1. **Get an Apple Developer ID certificate**
   - Enroll in the Apple Developer Program ($99/year)
   - Create a "Developer ID Application" certificate in Xcode or developer.apple.com
   - Install the certificate in your macOS Keychain

2. **Create an app-specific password**
   - Go to appleid.apple.com
   - Sign in and go to Security → App-Specific Passwords
   - Generate a new password for "electron-builder"

3. **Set environment variables**

   Add to your `~/.zshrc` or `~/.bash_profile`:

   ```bash
   export APPLE_ID="your-apple-id@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="XXXXXXXXXX"  # Your 10-character Team ID
   ```

4. **Update package.json**

   Add to the `"mac"` section in `package.json`:

   ```json
   "mac": {
     "hardenedRuntime": true,
     "gatekeeperAssess": false,
     "entitlements": "build/entitlements.mac.plist",
     "entitlementsInherit": "build/entitlements.mac.plist",
     "notarize": {
       "teamId": "XXXXXXXXXX"
     }
   }
   ```

5. **Create entitlements file**

   Create `build/entitlements.mac.plist`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>com.apple.security.cs.allow-jit</key>
     <true/>
     <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
     <true/>
     <key>com.apple.security.cs.disable-library-validation</key>
     <true/>
   </dict>
   </plist>
   ```

6. **Build**

   ```bash
   npm run dist:mac
   ```

   The build process will automatically sign and notarize the app. Notarization can take 5-15 minutes.

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


