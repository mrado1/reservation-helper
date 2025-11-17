# Reservation Helper - Distribution Guide

## Current Build: v0.1.0

Successfully built distributable applications for macOS and Windows.

## Available Downloads

### macOS (Apple Silicon / M1/M2/M3)
- **DMG Installer**: `Reservation Helper-0.1.0-arm64.dmg` (91 MB)
  - Drag-and-drop installation
  - Recommended for most users
  
- **ZIP Archive**: `Reservation Helper-0.1.0-arm64-mac.zip` (87 MB)
  - Extract and run directly
  - Alternative to DMG

### Windows (x64)
- **Installer**: `Reservation Helper Setup 0.1.0.exe` (73 MB)
  - One-click NSIS installer
  - Works on all modern Windows PCs (Windows 10/11)
  - Installs to user's AppData directory
  - Creates Start Menu shortcuts

## Installation Instructions

### macOS
1. Download `Reservation Helper-0.1.0-arm64.dmg`
2. Open the DMG file
3. Drag "Reservation Helper" to your Applications folder
4. Launch from Applications or Spotlight

**First Launch Note**: Since this build is unsigned, you'll need to:
- Right-click the app → "Open" (don't double-click)
- Click "Open" in the security dialog
- The app will open normally after this first time

### Windows
1. Download `Reservation Helper Setup 0.1.0.exe`
2. Run the installer
3. Click through the installation wizard
4. Launch from Start Menu or Desktop shortcut

**SmartScreen Note**: Since this build is unsigned, Windows SmartScreen may show a warning:
- Click "More info"
- Click "Run anyway"
- The app will install and run normally

## What's Included

All builds include:
- ✅ Full booking functionality (Steps 1-3)
- ✅ Embedded Reserve America browser
- ✅ Request/response logging
- ✅ Countdown timer for 9 AM releases
- ✅ Success overlay with "Start over" functionality
- ✅ All recent UI improvements (scrollbar hiding, padding, etc.)

## Known Limitations

### Unsigned Builds
These builds are **not code-signed or notarized**, which means:
- macOS will show Gatekeeper warnings on first launch
- Windows SmartScreen may flag the installer as unrecognized
- Both platforms require extra steps to install (see above)

**Why?** Code signing requires:
- Apple Developer Program membership ($99/year) for macOS
- Windows code signing certificate ($200-400/year) for Windows

For internal testing, unsigned builds work fine once you bypass the initial security prompts.

### Architecture Support
- **macOS**: ARM64 only (M1/M2/M3/M4 Macs)
  - Intel Macs can run this via Rosetta 2 translation (built-in compatibility layer)
  - For native Intel builds, we'd need to build on an Intel Mac or configure universal binaries
  
- **Windows**: x64 build (works on all modern Windows PCs)
  - Compatible with Windows 10 and Windows 11
  - Both Intel and AMD processors supported

## File Locations

All build artifacts are in:
```
desktop-app/dist/
├── Reservation Helper-0.1.0-arm64.dmg          # macOS DMG
├── Reservation Helper-0.1.0-arm64-mac.zip      # macOS ZIP
└── Reservation Helper Setup 0.1.0.exe          # Windows installer
```

## Sharing with Testers

### Option 1: Direct File Sharing
1. Upload the installers to Google Drive, Dropbox, or similar
2. Share the download links with testers
3. Include the installation instructions above

### Option 2: GitHub Releases (if repo is private)
1. Create a new release: `git tag v0.1.0 && git push --tags`
2. Go to GitHub → Releases → Draft a new release
3. Upload the DMG, ZIP, and EXE files
4. Publish the release
5. Share the release URL with testers

## Next Steps

### For Production Release
To create properly signed builds that don't require security bypasses:

1. **macOS Signing & Notarization**
   - Enroll in Apple Developer Program
   - Get Developer ID certificate
   - Configure notarization (see BUILD.md)
   - Rebuild with signing enabled

2. **Windows Signing**
   - Purchase code signing certificate
   - Configure certificate in build process
   - Rebuild with signing enabled

3. **Add App Icons**
   - Create 1024x1024 PNG icon
   - Convert to .icns (macOS) and .ico (Windows)
   - Place in `build/` directory
   - Rebuild (see `build/ICON_README.md`)

4. **Build for All Architectures**
   - macOS: Universal binary (Intel + Apple Silicon)
   - Windows: x64 build (most Windows PCs)

5. **Auto-Update Infrastructure**
   - Configure electron-updater
   - Set up update server or use GitHub Releases
   - Add "Check for updates" to the app

## Testing Checklist

When distributing to testers, ask them to verify:
- [ ] App installs successfully
- [ ] App launches without crashes
- [ ] Can sign in to Reserve America
- [ ] Can select facility and site
- [ ] Can book a reservation
- [ ] Logs show all requests/responses
- [ ] Success overlay appears after booking
- [ ] "Start over" button resets the app
- [ ] No horizontal scrolling in either pane
- [ ] Scrollbars hide when not in use

## Support

For build issues or questions, see:
- `BUILD.md` - Detailed build instructions
- `build/ICON_README.md` - Icon generation guide
- `README.md` - General app documentation

## Version History

### v0.1.0 (Current)
- Initial distributable release
- Full M1-M7 feature set
- M9 logging and UI improvements
- Unsigned builds for internal testing

