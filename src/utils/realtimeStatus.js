/**
 * Realtime data pipeline status.
 *
 * Background polling is started only by the WebSocket server, events are
 * generated only when EVENTS_ENABLED is on, and events reach maple only when
 * the webhook client has both a URL and a secret. Any of these being off (for
 * example left over from the Nov 2025 data freeze) silently stops push events
 * while HTTP proxying keeps working, so surface it explicitly.
 *
 * @param {Object} config - Application config (src/config)
 * @returns {{websocket: boolean, events: boolean, webhookConfigured: boolean, warnings: string[]}}
 */
function getRealtimeStatus(config) {
  const websocket = !!config.websocket?.enabled;
  const events = !!config.events?.enabled;
  const webhookConfigured = !!(config.events?.webhookUrl && config.events?.webhookSecret);
  const warnings = [];

  if (!websocket) {
    warnings.push('WebSocket disabled (WEBSOCKET_ENABLED=false): background polling is not running, so no events are generated or sent to maple');
  }
  if (!events) {
    warnings.push('Event generation disabled (EVENTS_ENABLED=false): no events are sent to maple');
  } else if (!webhookConfigured) {
    warnings.push('Event webhook not configured (EVENTS_WEBHOOK_URL / EVENTS_WEBHOOK_SECRET missing): events are not delivered to maple');
  }

  return { websocket, events, webhookConfigured, warnings };
}

module.exports = { getRealtimeStatus };
