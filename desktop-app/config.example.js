/**
 * Configuration Template for Reservation Helper
 * 
 * Copy this file to config.js and fill in your values:
 *   cp config.example.js config.js
 * 
 * For production builds, set these as environment variables:
 * - POSTHOG_API_KEY
 * - POSTHOG_HOST (optional, defaults to PostHog Cloud)
 */

module.exports = {
  // PostHog Analytics Configuration
  posthog: {
    // Get your API key from: https://app.posthog.com/project/settings
    apiKey: process.env.POSTHOG_API_KEY || 'YOUR_POSTHOG_API_KEY_HERE',
    
    // PostHog host (use cloud by default)
    host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
    
    // Batch settings (optimize for performance)
    flushAt: 10,           // Send events in batches of 10
    flushInterval: 10000,  // Or every 10 seconds
  },
  
  // Feature Flags (fetched from PostHog)
  defaultFlags: {
    app_enabled: true,
    booking_enabled: true,
  },
  
  // Development mode detection
  isDev: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV,
};

