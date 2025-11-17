/**
 * Configuration for Reservation Helper
 * 
 * For production builds, set these as environment variables:
 * - POSTHOG_API_KEY
 * - POSTHOG_HOST (optional, defaults to PostHog Cloud)
 */

module.exports = {
  // PostHog Analytics Configuration
  posthog: {
    // Project API key (write-only, for sending events).
    // In development, set via .env as POSTHOG_API_KEY.
    // In production builds, this falls back to a non-empty placeholder so the
    // app doesn't crash if env vars are missing. Replace with a real key on
    // your build machine when you want live analytics/flags in distributed apps.
    apiKey: process.env.POSTHOG_API_KEY || 'phc_YOUR_PROJECT_API_KEY_HERE',
    
    // Personal / feature-flags API key (for reading feature flags).
    // Set via .env as POSTHOG_PERSONAL_API_KEY in development, and optionally
    // hard-code on your build machine for production if you want remote kill
    // switches to work in distributed apps.
    personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY || 'YOUR_FEATURE_FLAGS_API_KEY_HERE',
    
    // PostHog host (use cloud by default)
    host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
    
    // Batch settings (optimize for performance)
    flushAt: 10,           // Send events in batches of 10
    flushInterval: 10000,  // Or every 10 seconds
  },
  
  // Feature Flags (fetched from PostHog)
  defaultFlags: {
    // If PostHog is unreachable or returns no flags, we default to enabled.
    app_enabled: true,
    booking_enabled: true,
  },
  
  // Development mode detection
  // Only true if explicitly set to 'development'
  isDev: process.env.NODE_ENV === 'development',
};

