# Reservation Helper

A desktop application to help secure hard-to-get campsite reservations on Reserve America. Built with Electron, this app automates the booking process with high-speed polling and countdown timers for 9 AM release windows.

![Version](https://img.shields.io/badge/version-0.4.5-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![License](https://img.shields.io/badge/license-Private-red)

## Features

### ✅ Current Features (M1-M9)

- **🔐 Authenticated Booking**: Sign in to Reserve America directly in the app
- **🎯 Smart Context Detection**: Automatically detects facility and site from your browsing
- **⚡ High-Speed Polling**: Sends 100+ requests per second when booking opens
- **⏰ Countdown Timer**: Arms automatically for 9 AM releases (9 months in advance)
- **📊 Developer Logs**: Real-time request/response logging with color-coded status
- **✅ Success Overlay**: Locks UI after successful booking to prevent accidental changes
- **🎨 Modern UI**: Clean, responsive interface with Tailwind CSS
- **🖥️ Cross-Platform**: Native installers for macOS and Windows

### 🚀 M10: Auto-Updates, Analytics, Feature Flags

- **Auto-Updates**: Automatic app updates via GitHub Releases (macOS signed DMG, Windows NSIS installer)
- **Analytics**: Anonymous usage tracking with PostHog (app launches, booking attempts, success/error)
- **Feature Flags**: Remote control and kill switches:
  - `app_enabled` – global kill switch (disable entire app)
  - `booking_enabled` – disable booking while keeping UI available

## Installation

### macOS

1. Download `Reservation Helper-0.1.0-arm64.dmg` from [Releases](https://github.com/mrado1/reservation-helper/releases)
2. Open the DMG and drag the app to Applications
3. Right-click the app → "Open" (first launch only, due to unsigned build)

**Note**: Works natively on Apple Silicon (M1/M2/M3/M4). Intel Macs run via Rosetta 2.

### Windows

1. Download `Reservation Helper Setup 0.1.0.exe` from [Releases](https://github.com/mrado1/reservation-helper/releases)
2. Run the installer
3. Click "More info" → "Run anyway" if SmartScreen appears (first launch only)

**Note**: Requires Windows 10 or later (x64).

## Usage

### Step 1: Sign In
1. Launch the app
2. Sign in to Reserve America in the embedded browser
3. Wait for the green checkmarks to appear

### Step 2: Find Your Site
1. Navigate to your desired campsite on Reserve America
2. The app automatically detects the facility and site
3. Click "Refresh" if needed to update the context

### Step 3: Book Your Reservation
1. Select your arrival date and number of nights
2. Click "Add to Cart" for immediate booking
3. Or let the countdown timer auto-start at 9 AM for future releases

### Success!
- When booking succeeds, a success overlay appears
- Click "Start Over" to book another site
- Complete checkout in the Reserve America browser

## Development

### Prerequisites

- Node.js 18+ and npm
- macOS (for macOS builds) or Windows (for Windows builds)
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/mrado1/reservation-helper.git
cd reservation-helper

# Install dependencies
cd desktop-app
npm install

# Run in development mode
npm start
```

### Project Structure

```
reservation-helper/
├── desktop-app/           # Electron desktop application
│   ├── main.js           # Main process (Node.js)
│   ├── preload.js        # Preload script (IPC bridge)
│   ├── renderer/         # Renderer process (UI)
│   │   ├── index.html    # Main UI
│   │   ├── renderer.js   # UI logic
│   │   └── styles.css    # Tailwind styles
│   ├── build/            # App icons and assets
│   └── dist/             # Build output
├── shell-script/         # Legacy shell script version
├── docs/
│   ├── product/          # Product requirements (M1-M10)
│   ├── technical/        # Technical implementation guides
│   └── progress/         # Milestone progress tracking
└── README.md
```

### Building

```bash
cd desktop-app

# Build for macOS
npm run dist:mac

# Build for Windows
npm run dist:win

# Build for all platforms
npm run dist
```

Outputs are in `desktop-app/dist/`.

### Publishing Releases

```bash
# Set GitHub token, token is in 1Pass
export GH_TOKEN="your_github_token_here"

# Bump version
npm version patch  # or minor, or major

# Build and publish to GitHub Releases
npm run publish
```

See [BUILD.md](docs/technical/build.md) for detailed build instructions.

## Documentation

### Product Documentation
- [M1: Core Polling](docs/product/m1.md) - Basic polling mechanism
- [M2: Context Detection](docs/product/m2.md) - Auto-detect facility/site
- [M3: Desktop App](docs/product/m3.md) - Electron wrapper
- [M4: Date Validation](docs/product/m4.md) - Booking window validation
- [M5: Embedded Browser](docs/product/m5.md) - In-app Reserve America browser
- [M6: Countdown Timer](docs/product/m6.md) - Auto-start for 9 AM releases
- [M7: Auth Integration](docs/product/m7.md) - Cookie-based authentication
- [M8: Packaging](docs/product/m8.md) - Distribution and installers
- [M9: Logging & UI](docs/product/m9.md) - Developer logs and polish
- [M10: Auto-Updates](docs/product/m10.md) - Updates, analytics, feature flags

### Technical Documentation
- [Overview](docs/technical/overview.md) - Architecture overview
- [Build Guide](docs/technical/build.md) - Building and packaging
- [Distribution Guide](docs/technical/distribution.md) - Sharing with users
- [M10 Implementation](docs/technical/m10-implementation.md) - Auto-updates setup

## How It Works

### The Reserve America Booking Problem

Popular campsites on Reserve America are released exactly 9 months in advance at 9:00 AM local time. These sites are often fully booked within seconds due to high demand and automated booking tools.

### Our Solution

1. **Pre-Authentication**: Sign in before the booking window opens
2. **Context Detection**: Automatically capture facility and site IDs from your browsing
3. **Countdown Timer**: Start polling at exactly 9:00:00 AM (with 1-second early start)
4. **High-Speed Polling**: Send 100+ requests per second to Reserve America's API
5. **Success Detection**: Automatically detect when the site is added to cart
6. **UI Lock**: Prevent accidental changes after successful booking

### Technical Details

- **Polling Rate**: ~150 requests/second (configurable)
- **Request Method**: Direct API calls to Reserve America's `additem` endpoint
- **Authentication**: Uses existing Reserve America session cookies
- **Success Detection**: Monitors cart state and HTTP response codes
- **Error Handling**: Graceful degradation for rate limits and overlapping reservations

## Privacy & Ethics

### What We Track (M10+)
- Anonymous usage statistics (app launches, booking attempts)
- Success/error rates for improving the app
- No personal information, no booking details, no user data

### What We Don't Do
- We don't bypass Reserve America's security
- We don't create fake accounts or use proxies
- We don't book sites you don't want
- We don't share or sell any data

### Fair Use
This tool simply automates what you would do manually: repeatedly refreshing and clicking "Add to Cart" at 9 AM. It's designed for personal use to help you secure a campsite for your family, not for commercial reselling or hoarding sites.

## Troubleshooting

### macOS: "App is damaged and can't be opened"
**Solution**: Right-click the app → "Open" (don't double-click). This is because the app is unsigned.

### Windows: SmartScreen warning
**Solution**: Click "More info" → "Run anyway". This is because the app is unsigned.

### "Not signed in" even though I logged in
**Solution**: 
1. Make sure you're on the Reserve America sign-in page
2. Complete the login process
3. Wait for the page to redirect to the dashboard
4. The app should detect your session automatically

### Booking fails with "overlapping reservation" error
**Solution**: You already have a reservation at this facility. Reserve America limits you to 1 active reservation per facility. Cancel or use your existing reservation first.

### Update check fails
**Solution**: This is normal for v0.1.0 (no auto-updates yet). M10 will add automatic updates.

## Contributing

This is a private project for personal use. If you have suggestions or find bugs, please open an issue.

## Roadmap

- [x] M1: Core polling mechanism
- [x] M2: Context detection
- [x] M3: Desktop app wrapper
- [x] M4: Date validation
- [x] M5: Embedded browser
- [x] M6: Countdown timer
- [x] M7: Auth integration
- [x] M8: Packaging & distribution
- [x] M9: Logging & UI polish
- [ ] M10: Auto-updates, analytics, feature flags (in progress)
- [ ] M11: User authentication (future)
- [ ] M12: Crash reporting (future)
- [ ] M13: Multi-site booking (future)

See [roadmap.md](docs/product/roadmap.md) for detailed plans.

## License

Private - Not for redistribution.

## Disclaimer

This tool is provided as-is for personal use. Use at your own risk. The authors are not responsible for any issues arising from the use of this software, including but not limited to:
- Failed bookings
- Account restrictions from Reserve America
- Any violations of Reserve America's terms of service

Always review and comply with Reserve America's terms of service.

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [documentation](docs/)
3. Open an issue on GitHub

---

**Made with ❤️ for camping enthusiasts who just want a fair shot at booking their favorite sites.**

