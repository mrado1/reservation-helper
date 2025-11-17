# 🏕️ Reserve America API Poller

A simple, portable bash script for polling Reserve America booking APIs at regular intervals.

## Prerequisites

- macOS (or any system with bash and curl)
- No additional installations required!

## Usage

### First Time Setup

1. **Run the script:**
   ```bash
   ./poll_camping_api.sh
   ```

2. **The script will create two empty files** and ask you to fill them:
   - `.jwt_token` - Your JWT authorization token
   - `.a1data` - Your a1Data cookie (URL encoded format from browser)

3. **Fill in the required files:**
   
   **JWT Token:**
   ```bash
   # Get this from your browser's cookies, it will be under `idToken`
   # Example format: eyJraWQiOiJiOUZPc0pUblF1NTRBdVEz...
   open .jwt_token  # Then paste and save
   ```
   
   **a1Data Cookie:**
   ```bash
   # Get this from your browser's cookies, it will be under `a1Data` but you should make sure that it is URL-decoded, not the brackets wrapping the whole string.
   # Example format: {"sessionID":"0A7F9325E02CD243A541...
   open .a1data  # Then paste and save
   ```

4. Set the values in input.json
- Grab the facilityId and siteId, 140 and 245719 respectively in this example:
https://www.reserveamerica.com/explore/glen-island-lake-george-is/NY/140/245719/campsite-booking?arrivalDate=2026-05-17&lengthOfStay=1&availStartDate=2026-05-17
- Set the arrivalDate
- Set the units for the number of nights you need

5. **Run the script again:**
   ```bash
   ./poll_camping_api.sh
   ```

### Normal Usage

Once both `.jwt_token` and `.a1data` files are filled, just run:

```bash
./poll_camping_api.sh
```

The script will:
- Automatically load your JWT token from `.jwt_token`
- Automatically load and URL-decode your a1Data from `.a1data`
- Start polling the configured endpoints in aggressive mode (~100 requests/second)
- Display results with timestamps (including milliseconds) and status indicators
- Save all output to a log file: `camping_poll_YYYYMMDD_HHMMSS.log`
- Auto-kill if it receives HTTP 000 (rate limited/blocked)

**Stop the script:** Press `Ctrl+C` to exit cleanly
