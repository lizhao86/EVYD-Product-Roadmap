/**
 * Vercel Speed Insights Integration
 * Initializes Speed Insights for this vanilla JavaScript application
 */

import { injectSpeedInsights } from './node_modules/@vercel/speed-insights/dist/index.mjs';

// Initialize Speed Insights with default configuration
injectSpeedInsights({
  debug: false, // Set to true for development debugging
  sampleRate: 1, // Send 100% of events
});
