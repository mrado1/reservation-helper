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
    // Project API key (write-only, for sending events)
    // Set in .env file as POSTHOG_API_KEY
    apiKey: process.env.POSTHOG_API_KEY,
    
    // Personal API key (for reading feature flags)
    // Set in .env file as POSTHOG_PERSONAL_API_KEY
    personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
    
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
    countdown_enabled: true,
  },
  
  // Development mode detection
  // Only true if explicitly set to 'development'
  isDev: process.env.NODE_ENV === 'development',
};

