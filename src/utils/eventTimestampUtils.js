/**
 * Shared utilities for ensuring event timestamp uniqueness
 * Provides consistent event ordering and timestamp offsetting
 */

/**
 * Event priority mapping for logical ordering
 * Lower numbers = higher priority (processed first)
 */
const EVENT_PRIORITIES = {
  // Draw events - logical order of occurrence
  'draw_match_result': 0,        // Match completes first
  'draw_player_advanced': 1,     // Players advance after match completion
  'draw_round_completed': 2,     // Round completes after all advancements
  'draw_tournament_completed': 3, // Tournament completes last
  
  // Live match events - logical order
  'match_finished': 0,           // Match ends first
  'set_completed': 1,            // Set completion before other updates
  'match_started': 2,            // New matches start
  'match_play_began': 3,         // Play begins after match starts
  'score_updated': 4,            // Regular score updates
  'court_changed': 5,            // Court changes
  'match_suspended': 6,          // Suspensions
  'match_resumed': 7,            // Resumptions
  'medical_timeout': 8,          // Medical timeouts
  'toilet_break': 9,             // Toilet breaks
  'challenge_in_progress': 10,   // Challenges
  'correction_mode': 11,         // Corrections
  'warmup_started': 12,          // Warmups
  'umpire_on_court': 13         // Umpire arrival
};

/**
 * Apply microsecond offsets to ensure unique timestamps
 * @param {Array} events - Array of events to process
 * @param {boolean} sortByPriority - Whether to sort events by priority first
 * @returns {Array} Events with unique timestamps
 */
function ensureUniqueTimestamps(events, sortByPriority = true) {
  if (!events || events.length === 0) {
    return events;
  }
  
  // Clone events to avoid mutation
  const processedEvents = [...events];
  
  // Sort by priority if requested
  if (sortByPriority) {
    processedEvents.sort((a, b) => {
      const priorityA = EVENT_PRIORITIES[a.event_type] ?? 999;
      const priorityB = EVENT_PRIORITIES[b.event_type] ?? 999;
      return priorityA - priorityB;
    });
  }
  
  // Apply microsecond offsets to ensure uniqueness
  processedEvents.forEach((event, index) => {
    if (event.event_timestamp) {
      const baseTime = new Date(event.event_timestamp);
      const offsetTime = new Date(baseTime.getTime() + index);
      event.event_timestamp = offsetTime.toISOString();
    }
  });
  
  return processedEvents;
}

/**
 * Sort events by logical priority
 * @param {Array} events - Array of events to sort
 * @returns {Array} Sorted events
 */
function sortEventsByPriority(events) {
  if (!events || events.length === 0) {
    return events;
  }
  
  return [...events].sort((a, b) => {
    const priorityA = EVENT_PRIORITIES[a.event_type] ?? 999;
    const priorityB = EVENT_PRIORITIES[b.event_type] ?? 999;
    return priorityA - priorityB;
  });
}

/**
 * Get the priority value for an event type
 * @param {string} eventType - The event type
 * @returns {number} Priority value (lower = higher priority)
 */
function getEventPriority(eventType) {
  return EVENT_PRIORITIES[eventType] ?? 999;
}

module.exports = {
  EVENT_PRIORITIES,
  ensureUniqueTimestamps,
  sortEventsByPriority,
  getEventPriority
};