#!/usr/bin/env node
/**
 * Reserve America Rate/Throttle Probe
 *
 * Goals:
 * - Measure how HTTP 000 (connection throttle) and HTTP 429 (rate limit) respond to varying concurrency/rates
 * - Get quick, actionable numbers to tune the desktop app around unlock time
 *
 * Usage examples:
 *   node rate_probe.js --concurrency=20 --durationSec=10
 *   node rate_probe.js --concurrency=50 --durationSec=15 --cadenceMs=0
 *   node rate_probe.js --concurrency=10 --rampTo=200 --rampEverySec=2 --rampStep=10 --durationSec=40
 *   node rate_probe.js --concurrency=300 --burstAt="2025-11-13T09:00:00.000-05:00" --durationSec=5
 *
 * Requirements: .jwt_token, .a1data, input.json at project root (same as poll_camping_api.sh)
 */

/* eslint-disable no-console */
const fs = require('fs');

function arg(name, def) {
  const match = process.argv.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=').trim() : def;
}

const JWT = (fs.readFileSync('.jwt_token', 'utf8') || '').trim();
const A1 = (fs.readFileSync('.a1data', 'utf8') || '').replace(/[\r\n]+/g, '');
if (!JWT || !A1) {
  console.error('Missing .jwt_token or .a1data. Create them first (see poll_camping_api.sh).');
  process.exit(1);
}

const payloadPath = arg('payloadPath', 'input.json');
if (!fs.existsSync(payloadPath)) {
  console.error(`Missing ${payloadPath}. Create it first (see poll_camping_api.sh).`);
  process.exit(1);
}
const payload = fs.readFileSync(payloadPath, 'utf8').trim();
if (!payload) {
  console.error(`Empty ${payloadPath}.`);
  process.exit(1);
}

const url = arg('url', 'https://api.reserveamerica.com/jaxrs-json/shoppingcart/0/additem');
const durationSec = Number(arg('durationSec', '15'));
let maxConcurrent = Number(arg('concurrency', '20'));
const cadenceMs = Number(arg('cadenceMs', '0')); // 0 = fill immediately to available slots
const rampTo = Number(arg('rampTo', String(maxConcurrent)));
const rampEverySec = Number(arg('rampEverySec', '0'));
const rampStep = Number(arg('rampStep', '0'));
const burstAtArg = arg('burstAt', '');
const burstAt = burstAtArg ? (isNaN(Number(burstAtArg)) ? Date.parse(burstAtArg) : Number(burstAtArg)) : null;

const headers = {
  'a1data': A1,
  'accept': 'application/json',
  'accept-language': 'en-US,en;q=0.9',
  'access-control-allow-headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,humanVerificationToken,humanVerificationTokenV3,humanVerificationActionV3,a1Data,privateKey,access-control-allow-methods,X-Requested-With,Access-Control-Allow-Origin,Accept,Origin,Access-Control-Allow-Headers,Access-Control-Request-Headers',
  'access-control-allow-methods': 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT',
  'access-control-allow-origin': 'https://www.reserveamerica.com/',
  'authorization': JWT,
  'cache-control': 'no-cache',
  'content-type': 'application/json',
  'origin': 'https://www.reserveamerica.com',
  'pragma': 'no-cache',
  'priority': 'u=1, i',
  'referer': 'https://www.reserveamerica.com/',
  'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
};

let inFlight = 0;
let sent = 0;
let done = 0;
const hist = Object.create(null); // statusCode -> count; 0 means network/abort error
const firstErrBodies = [];
const start = Date.now();

function noteStatus(code) {
  hist[code] = (hist[code] || 0) + 1;
}

async function sendOnce() {
  inFlight++;
  sent++;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    // global fetch exists on Node >= 18
    const res = await fetch(url, { method: 'POST', headers, body: payload, signal: controller.signal });
    clearTimeout(timeout);
    const status = res.status;
    noteStatus(status);
    if (status >= 400) {
      try {
        const txt = await res.text();
        if (firstErrBodies.length < 5) {
          firstErrBodies.push({ status, body: txt.slice(0, 600) });
        }
      } catch {
        // ignore body read errors
      }
    }
  } catch (e) {
    // Treat connection errors/timeouts as "HTTP 000"
    noteStatus(0);
  } finally {
    inFlight--;
    done++;
  }
}

function topUp() {
  if (Date.now() - start > durationSec * 1000) return;
  const slots = Math.max(0, maxConcurrent - inFlight);
  if (slots <= 0) return;
  // If cadenceMs > 0, emit only one per tick; else fill slots immediately
  const emits = cadenceMs > 0 ? 1 : slots;
  for (let i = 0; i < emits; i++) sendOnce();
}

function perSecondLog() {
  const now = Date.now();
  const elapsed = ((now - start) / 1000).toFixed(1);
  const keys = ['0', '200', '417', '429', '400', '401', '403', '404', '500', '503'];
  const known = keys.map(k => `${k}:${hist[k] | 0}`).join(' ');
  const otherCount = Object.keys(hist).filter(k => !keys.includes(k)).length;
  console.log(`[t=${elapsed}s] inFlight=${inFlight} sent=${sent} done=${done} | ${known} other=${otherCount}`);
}

if (burstAt) {
  const delay = Math.max(0, burstAt - Date.now());
  console.log(`Scheduling burst of ${maxConcurrent} at ${new Date(burstAt).toISOString()} (in ${delay}ms)`);
  setTimeout(() => {
    for (let i = 0; i < maxConcurrent; i++) sendOnce();
  }, delay);
} else {
  setInterval(topUp, Math.max(1, cadenceMs || 1));
}

// Optional ramp to grow concurrency over time
if (rampEverySec > 0 && rampStep > 0 && rampTo > maxConcurrent) {
  const rampTimer = setInterval(() => {
    maxConcurrent = Math.min(rampTo, maxConcurrent + rampStep);
    console.log(`Ramping concurrency -> ${maxConcurrent}`);
    if (maxConcurrent >= rampTo) clearInterval(rampTimer);
  }, rampEverySec * 1000);
}

const logTimer = setInterval(perSecondLog, 1000);
setTimeout(() => {
  clearInterval(logTimer);
  // small drain window
  setTimeout(() => {
    console.log('\nSummary:');
    console.log(JSON.stringify({ durationSec, sent, done, inFlight, hist }, null, 2));
    if (firstErrBodies.length) {
      console.log('\nSample error bodies (truncated):');
      firstErrBodies.forEach((e, i) => {
        console.log(`--- #${i + 1} [${e.status}] ---\n${e.body}\n`);
      });
    }
    process.exit(0);
  }, 600);
}, durationSec * 1000);


