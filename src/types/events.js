/**
 * Event types for tennis tournament events
 */
const EVENT_TYPES = {
  MATCH_STARTED: 'match_started',
  MATCH_FINISHED: 'match_finished',
  SCORE_UPDATED: 'score_updated',
  SET_COMPLETED: 'set_completed',
  GAME_WON: 'game_won',
  BREAK_POINT: 'break_point',
  TIEBREAK_STARTED: 'tiebreak_started',
  MATCH_SUSPENDED: 'match_suspended',
  MATCH_RESUMED: 'match_resumed',
  COURT_CHANGED: 'court_changed',
  MATCH_DELAYED: 'match_delayed',
  PLAYER_RETIRED: 'player_retired',
  MEDICAL_TIMEOUT: 'medical_timeout',
  DRAW_UPDATED: 'draw_updated',
  DRAW_PAIRING_ANNOUNCED: 'draw_pairing_announced'
};

/**
 * Event priority levels
 */
const EVENT_PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium', 
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * Create a standardized event object
 * @param {string} eventType - Type of event (from EVENT_TYPES)
 * @param {string} matchId - Unique match identifier
 * @param {string} description - Human-readable event description
 * @param {Object} data - Event-specific data
 * @param {Object} options - Additional options (priority, metadata)
 * @returns {Object} Standardized event object
 */
function createEvent(eventType, matchId, description, data = {}, options = {}) {
  return {
    event_type: eventType,
    timestamp: new Date().toISOString(),
    match_id: matchId,
    description,
    data: {
      ...data
    },
    priority: options.priority || EVENT_PRIORITY.MEDIUM,
    metadata: {
      source: 'atp-live-proxy',
      version: '1.0.0',
      ...options.metadata
    }
  };
}

/**
 * Validate event object structure
 * @param {Object} event - Event object to validate
 * @returns {boolean} True if valid event structure
 */
function validateEvent(event) {
  const requiredFields = ['event_type', 'timestamp', 'match_id', 'description', 'data'];
  return requiredFields.every(field => Object.prototype.hasOwnProperty.call(event, field)) &&
         Object.values(EVENT_TYPES).includes(event.event_type);
}

module.exports = {
  EVENT_TYPES,
  EVENT_PRIORITY,
  createEvent,
  validateEvent
};