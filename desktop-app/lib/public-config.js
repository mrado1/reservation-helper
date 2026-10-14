'use strict';
function publicConfig(config = {}) {
  return {
    posthog: { apiKey: config.posthog?.apiKey || 'disabled', host: config.posthog?.host || 'https://app.posthog.com', flushAt: 10, flushInterval: 10000 },
    defaultFlags: { app_enabled: true, booking_enabled: true, ...config.defaultFlags }
  };
}
module.exports = { publicConfig };
