const { diff } = require('json-diff-ts');
const { EVENT_TYPES, EVENT_PRIORITY, createEvent } = require('../types/events');
const eventOutput = require('./eventOutput');
const config = require('../config');

/**
 * Event generator service for detecting and creating tennis tournament events
 * Uses JSON diff to efficiently detect changes between polling intervals
 */
class EventGeneratorService {
  constructor() {
    this.previousStates = new Map(); // Store previous data states by endpoint
    this.finishedMatches = new Set(); // Track matches that have already sent finished events
    this.isEnabled = config.events.enabled;
    this.monitoredEndpoints = new Set(config.events.endpoints);
    if(this.isEnabled) {
      console.log(`[EVENTS] Event Generator Enabled (JSON Diff), monitoring: ${[...this.monitoredEndpoints].join(', ')}`);
    }
  }

  /**
   * Process endpoint data and generate events based on JSON diff changes
   * @param {string} endpoint - API endpoint path
   * @param {Object} currentData - Current polling data
   * @returns {Array} Generated events
   */
  processData(endpoint, currentData) {
    if (!this.isEnabled || !currentData || !this.monitoredEndpoints.has(endpoint)) {
      console.log(`[EVENTS] Ignoring endpoint ${endpoint}`);
      return [];
    }

    const events = [];
    const previousData = this.previousStates.get(endpoint);

    // Store current data for next comparison
    this.previousStates.set(endpoint, currentData);

    // Skip event generation on first poll (no previous data to compare)
    if (!previousData) {
      return events;
    }

    try {
      // Generate diff with match-specific configuration
      const diffOptions = this.getDiffOptions(endpoint, currentData, previousData);
      const changeset = diff(previousData, currentData, diffOptions);

      if (changeset && changeset.length > 0) {
        //console.log(`[EVENTS] Detected ${changeset.length} changes for ${endpoint}`);
        
        // Process changes based on endpoint type
        switch (endpoint) {
        case '/api/live-matches':
          events.push(...this.processLiveMatchChanges(changeset, currentData, previousData));
          break;
        case '/api/draws/live':
          events.push(...this.processDrawChanges(changeset, currentData));
          break;
        default:
          //console.log(`[EVENTS] No change handler for endpoint: ${endpoint}`);
        }
      }
    } catch (error) {
      console.error(`[EVENTS] Error processing diff for ${endpoint}:`, error.message);
    }

    // Output events if any were generated
    if (events.length > 0) {
      eventOutput.output(events);
    }

    return events;
  }

  /**
   * Get diff options for specific endpoint types
   * @param {string} endpoint - API endpoint path
   * @param {Object} currentData - Current data to analyze for best diff strategy
   * @param {Object} previousData - Previous data to analyze for best diff strategy
   * @returns {Object} Diff configuration options
   */
  getDiffOptions(endpoint, currentData = null, previousData = null) {
    const baseOptions = {
      embeddedObjKeys: {},
      ignoreArrayOrder: false,
      ignoreCase: false
    };

    switch (endpoint) {
    case '/api/live-matches': {
      // Determine the best key field to use based on actual data from both current and previous
      const currentMatches = this.extractMatches(currentData || {});
      const previousMatches = this.extractMatches(previousData || {});
      const allMatches = [...currentMatches, ...previousMatches];
      const keyField = this.determineBestKeyField(allMatches);
        
        
      if (keyField) {
        // Use the detected key field for better match tracking
        // Handle nested structure: TournamentMatches[0].Matches[n]
        return {
          ...baseOptions,
          embeddedObjKeys: {
            'TournamentMatches': '$index',  // Tournament level uses index
            'Matches': keyField,            // Match level uses MatchId
            'matches': keyField,
            'data': keyField
          }
        };
      } else {
        // Fallback to index-based if no consistent key field found
        // Handle nested structure: TournamentMatches[0].Matches[n]
        return {
          ...baseOptions,
          embeddedObjKeys: {
            'TournamentMatches': '$index',
            'Matches': '$index',
            'matches': '$index',
            'data': '$index'
          }
        };
      }
    }
    case '/api/draws/live':
      return {
        ...baseOptions,
        embeddedObjKeys: {
          'draws': '$index',
          'matches': '$index'
        }
      };
    default:
      return baseOptions;
    }
  }

  /**
   * Process live match changes using key-based comparison
   * @param {Array} changeset - Array of atomic changes (ignored - kept for API compatibility)
   * @param {Object} currentData - Current match data for context
   * @param {Object} previousData - Previous match data for comparison (optional, will use state if not provided)
   * @returns {Array} Generated match events
   */
  processLiveMatchChanges(changeset, currentData, previousData = null) {
    const events = [];
    
    // Get previous data for comparison - use parameter if provided, otherwise fallback to state
    if (!previousData) {
      previousData = this.previousStates.get('/api/live-matches');
      if (!previousData) {
        //console.log('[EVENTS] No previous data for live matches, skipping event generation');
        return events;
      }
    }

    // Extract matches from both datasets
    const previousMatches = this.extractMatches(previousData);
    const currentMatches = this.extractMatches(currentData);
    
    // Create maps keyed by MatchId for accurate comparison
    const previousMatchMap = this.createMatchMap(previousMatches);
    const currentMatchMap = this.createMatchMap(currentMatches);
    
    // Find newly added matches (in current but not in previous)
    for (const [matchId, match] of currentMatchMap) {
      if (!previousMatchMap.has(matchId)) {
        console.log(`[EVENTS] New match detected: ${matchId}`);
        // Only create started event if match is not finished AND not already in progress
        const matchStatus = this.extractStatus(match);
        if (matchStatus !== 'F' && matchStatus !== 'P') {
          const startedEvent = this.createMatchStartedEvent(match);
          if (startedEvent) events.push(startedEvent);
        } else {
          console.log(`[EVENTS] Skipping match started event for new match ${matchId} - status: ${matchStatus}`);
        }
      }
    }

    // Find removed matches (in previous but not in current)  
    for (const [matchId, match] of previousMatchMap) {
      if (!currentMatchMap.has(matchId)) {
        console.log(`[EVENTS] Match removed: ${matchId}`);
        // Only send finished event if we haven't already sent one for this match
        if (!this.finishedMatches.has(matchId)) {
          const finishedEvent = this.createMatchFinishedEvent(match);
          if (finishedEvent) {
            events.push(finishedEvent);
            this.finishedMatches.add(matchId);
          }
        }
      }
    }

    // Find updated matches (same MatchId in both, but fields changed)
    for (const [matchId, currentMatch] of currentMatchMap) {
      const previousMatch = previousMatchMap.get(matchId);
      if (previousMatch) {
        // Compare relevant fields for changes
        const fieldChanges = this.detectMatchFieldChanges(previousMatch, currentMatch);
        if (fieldChanges.length > 0) {
          //console.log(`[EVENTS] Match ${matchId} field changes:`, fieldChanges.map(c => `${c.field}: ${c.oldValue} -> ${c.newValue}`));
          const changeEvents = this.createEventFromFieldChanges(fieldChanges, currentMatch, matchId);
          events.push(...changeEvents);
        }
      }
    }

    // Deduplicate events to prevent multiple events for the same match in one cycle
    const deduplicatedEvents = this.deduplicateEvents(events);
    
    //console.log(`[EVENTS] events generated (${events.length} -> ${deduplicatedEvents.length} after deduplication): ${JSON.stringify(deduplicatedEvents, null, 2)}`);
    return deduplicatedEvents;
  }


  /**
   * Create specific events from a match-level change
   * @param {Object} change - Match change from json-diff-ts
   * @param {Map} matchMap - Map of current matches by ID
   * @returns {Array} Array of generated events
   */
  createEventFromMatchChange(change, matchMap) {
    const { type, key, value, changes } = change;

    switch (type) {
    case 'ADD':
      // New match added
      if (value) {
        const matchId = this.extractMatchId(value);
        if (matchId) {
          // Only create "started" event if match is actually in progress
          const matchStatus = this.extractStatus(value);
          if (matchStatus !== 'F' && matchStatus !== 'finished') {
            return [this.createMatchStartedEvent(value)];
          } else {
            console.log(`[EVENTS] Skipping match started event for ADD ${matchId} - match is already finished (status: ${matchStatus})`);
            return [];
          }
        }
      }
      break;

    case 'REMOVE':
      // Match removed (finished)
      if (value) {
        const matchId = this.extractMatchId(value);
        if (matchId) {
          return [this.createMatchFinishedEvent(value)];
        }
      }
      break;

    case 'UPDATE':
      // Match field updated - look at nested changes
      if (changes) {
        let match = null;
        let matchId = null;

        // If key looks like a match ID (string), try to find it in the match map
        if (typeof key === 'string' && matchMap.has(key)) {
          match = matchMap.get(key);
          matchId = key;
        }
        // Otherwise, try to find match by index in current data  
        else if (typeof key === 'string' || typeof key === 'number') {
          const matches = Array.from(matchMap.values());
          const index = parseInt(key, 10);
          if (!isNaN(index) && matches[index]) {
            match = matches[index];
            matchId = this.extractMatchId(match);
          }
        }

        if (match && matchId && changes) {
          return this.createEventFromFieldChanges(changes, match, matchId);
        }
      }
      break;

    default:
      break;
    }

    return [];
  }

  /**
   * Detect field changes between two match objects
   * @param {Object} previousMatch - Previous match state
   * @param {Object} currentMatch - Current match state
   * @returns {Array} Array of field change objects
   */
  detectMatchFieldChanges(previousMatch, currentMatch) {
    const changes = [];
    
    // List of fields to monitor for changes
    const fieldsToCheck = [
      { field: 'ResultString', name: 'score' },
      { field: 'Status', name: 'status' },
      { field: 'CourtName', name: 'court' },
      { field: 'MatchTime', name: 'matchTime' },
      { field: 'Serve', name: 'serve' }
    ];
    
    for (const { field, name } of fieldsToCheck) {
      const oldValue = previousMatch[field];
      const newValue = currentMatch[field];
      
      // Check for actual changes (handle null/undefined comparison)
      if (oldValue !== newValue) {
        changes.push({
          field: name,
          fieldPath: field,
          oldValue,
          newValue
        });
      }
    }
    
    return changes;
  }

  /**
   * Create events from field-level changes within a match
   * @param {Array} changes - Array of field change objects
   * @param {Object} match - Current match object
   * @param {string} matchId - Match identifier
   * @returns {Array} Array of generated events
   */
  createEventFromFieldChanges(changes, match, matchId) {
    const events = [];
    
    // Process each field change and generate appropriate events
    for (const fieldChange of changes) {
      const { field: fieldName, oldValue, newValue } = fieldChange;

      let event = null;

      // Score changes
      if (fieldName === 'score') {
        // Check for special score events first
        if (this.isSetCompletion(oldValue, newValue)) {
          event = this.createSetCompletedEvent(match, matchId, oldValue, newValue);
        } else if (this.isGameWin(oldValue, newValue)) {
          event = this.createGameWonEvent(match, matchId, oldValue, newValue);
        } else if (this.isTiebreakStart(oldValue, newValue)) {
          event = this.createTiebreakStartedEvent(match, matchId);
        } else {
          // Regular score update
          event = this.createScoreUpdateEvent(match, matchId, oldValue, newValue);
        }
      }

      // Court changes
      else if (fieldName === 'court') {
        event = this.createCourtChangeEvent(match, matchId, oldValue, newValue);
      }

      // Status changes
      else if (fieldName === 'status') {
        // Special handling for 'F' (Finished) status
        if (newValue === 'F' && !this.finishedMatches.has(matchId)) {
          event = this.createMatchFinishedEvent(match);
          if (event) {
            this.finishedMatches.add(matchId);
          }
        } else if (newValue !== 'F') {
          // For all other status changes, use the regular status change event
          event = this.createStatusChangeEvent(match, matchId, oldValue, newValue);
        }
        // If status is 'F' and we've already sent finished event, skip
      }

      if (event) {
        events.push(event);
      }
    }

    return events;
  }


  /**
   * Determine which player won the most recently completed set
   * @param {string} score - Current score
   * @returns {number} 1 or 2 indicating winner position in players array
   */
  getSetWinner(score) {
    const sets = score.trim().split(/\s+/);
    
    // Find the most recently completed set (not "00")
    for (let i = sets.length - 1; i >= 0; i--) {
      const set = sets[i];
      if (set && set !== '00' && set.length >= 2) {
        const player1Games = parseInt(set[0]);
        const player2Games = parseInt(set[1]);
        return player1Games > player2Games ? 1 : 2;
      }
    }
    
    return 1; // Default fallback
  }

  /**
   * Detect if score change represents a completed set
   * @param {string} oldScore - Previous score
   * @param {string} newScore - New score
   * @returns {boolean} True if set was completed
   */
  isSetCompletion(oldScore, newScore) {
    if (typeof oldScore !== 'string' || typeof newScore !== 'string') {
      return false;
    }
    
    // Parse scores into sets
    const oldSets = oldScore.trim().split(/\s+/);
    const newSets = newScore.trim().split(/\s+/);
    
    // A set was completed if:
    // 1. The number of sets increased (e.g., "46 53" -> "46 63 00")
    // 2. A new set started (indicated by "00" at the end of new score)
    // 3. The last set score changed to a winning score (e.g., "45" -> "46 00")
    
    // Check if number of sets increased
    if (newSets.length > oldSets.length) {
      // Check if the new set is "00" (indicating previous set finished)
      if (newSets[newSets.length - 1] === '00') {
        return true;
      }
    }
    
    // Check for specific patterns where a set was just won
    // Set winning scores: 6-0 to 6-4, 7-5, 7-6(tiebreak), or reverse
    const setWinPatterns = [
      /^6[0-4]$/, /^[0-4]6$/,     // 6-0 to 6-4 (60-64 or 06-46)
      /^75$/, /^57$/,              // 7-5
      /^76$/, /^67$/               // 7-6 (simplified, tiebreak score)
    ];
    
    // Check if the last complete set in new score is a winning pattern
    // and it wasn't already complete in the old score
    if (newSets.length >= 1) {
      // Get the last non-current set (exclude "00" or game scores like "15")
      for (let i = newSets.length - 1; i >= 0; i--) {
        const newSet = newSets[i].replace('-', ''); // Remove hyphen if present
        
        // Skip current game scores (00, 15, 30, 40, etc.)
        if (newSet.length <= 2 && !setWinPatterns.some(p => p.test(newSet))) {
          continue;
        }
        
        // Check if this set matches a winning pattern
        if (setWinPatterns.some(pattern => pattern.test(newSet))) {
          // Check if this same set was already complete in old score
          const oldSet = oldSets[i] ? oldSets[i].replace('-', '') : '';
          if (!setWinPatterns.some(pattern => pattern.test(oldSet))) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Detect if score change represents a game win
   * @param {string} oldScore - Previous score
   * @param {string} newScore - New score
   * @returns {boolean} True if game was won
   */
  isGameWin(oldScore, newScore) {
    if (typeof oldScore !== 'string' || typeof newScore !== 'string') {
      return false;
    }
    
    // Detect game score changes like "30-40" to "0-0" or "40-30" to "0-0"
    const gameWinPattern = /\b(0-0|15-0|0-15|30-0|0-30|40-0|0-40)\b/;
    return !gameWinPattern.test(oldScore) && gameWinPattern.test(newScore);
  }

  /**
   * Detect tiebreak start
   * @param {string} oldScore - Previous score
   * @param {string} newScore - New score
   * @returns {boolean} True if tiebreak started
   */
  isTiebreakStart(oldScore, newScore) {
    if (typeof oldScore !== 'string' || typeof newScore !== 'string') {
      return false;
    }
    
    // Detect tiebreak start: score goes from "6-6" to "6-6 (1-0)" or similar
    // But NOT from one tiebreak score to another like "6-6 (1-0)" to "6-6 (2-0)"
    const oldHasTiebreak = oldScore.includes('(') && oldScore.includes(')');
    const newHasTiebreak = newScore.includes('(') && newScore.includes(')');
    
    // Tiebreak starts if old score doesn't have tiebreak notation but new score does
    return !oldHasTiebreak && newHasTiebreak && oldScore.includes('6-6') && newScore.includes('6-6');
  }

  /**
   * Create match started event
   * @param {Object} match - Match object
   * @returns {Object} Match started event
   */
  createMatchStartedEvent(match) {
    const tournamentId = this.extractTournamentId(match);
    const matchId = this.extractMatchId(match);
    const players = this.extractPlayerNames(match);
    const description = `Match started: ${players.join(' vs ')}`;
    
    return createEvent(
      EVENT_TYPES.MATCH_STARTED,
      tournamentId,
      matchId,
      description,
      {
        players,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match),
        court: this.extractCourt(match),
        initialScore: this.extractScore(match)
      },
      { priority: EVENT_PRIORITY.HIGH }
    );
  }

  /**
   * Create match finished event
   * @param {Object} match - Match object
   * @param {Object} oldMatchData - Previous match data for context
   * @returns {Object} Match finished event
   */
  createMatchFinishedEvent(match, oldMatchData = null) {
    const tournamentId = this.extractTournamentId(match);
    const matchId = this.extractMatchId(match);
    const players = this.extractPlayerNames(match);
    const finalScore = this.extractScore(oldMatchData || match);
    const description = `Match finished: ${players.join(' vs ')} (${finalScore})`;
    
    return createEvent(
      EVENT_TYPES.MATCH_FINISHED,
      tournamentId,
      matchId,
      description,
      {
        players,
        finalScore,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.HIGH }
    );
  }

  /**
   * Create score update event
   * @param {Object} match - Match object
   * @param {string} matchId - Match ID
   * @param {string} oldScore - Previous score
   * @param {string} newScore - New score
   * @returns {Object} Score update event
   */
  createScoreUpdateEvent(match, matchId, oldScore, newScore) {
    const tournamentId = this.extractTournamentId(match);
    const players = this.extractPlayerNames(match);
    const description = `Score update: ${players.join(' vs ')} - ${newScore}`;
    
    return createEvent(
      EVENT_TYPES.SCORE_UPDATED,
      tournamentId,
      matchId,
      description,
      {
        players,
        previousScore: oldScore,
        currentScore: newScore,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.MEDIUM }
    );
  }

  /**
   * Create set completed event
   * @param {Object} match - Match object
   * @param match started{string} matchId - Match ID
   * @param {string} oldScore - Previous score
   * @param {string} newScore - New score
   * @returns {Object} Set completed event
   */
  createSetCompletedEvent(match, matchId, oldScore, newScore) {
    const tournamentId = this.extractTournamentId(match);
    const players = this.extractPlayerNames(match);
    const description = `Set completed: ${players.join(' vs ')} - ${newScore}`;
    
    return createEvent(
      EVENT_TYPES.SET_COMPLETED,
      tournamentId,
      matchId,
      description,
      {
        players,
        previousScore: oldScore,
        currentScore: newScore,
        setWinner: this.getSetWinner(newScore),
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.HIGH }
    );
  }

  /**
   * Create game won event
   * @param {Object} match - Match object
   * @param {string} matchId - Match ID
   * @param {string} oldScore - Previous score
   * @param {string} newScore - New score
   * @returns {Object} Game won event
   */
  createGameWonEvent(match, matchId, oldScore, newScore) {
    const tournamentId = this.extractTournamentId(match);
    const players = this.extractPlayerNames(match);
    const description = `Game completed: ${players.join(' vs ')} - ${newScore}`;
    
    return createEvent(
      EVENT_TYPES.GAME_WON,
      tournamentId,
      matchId,
      description,
      {
        players,
        previousScore: oldScore,
        currentScore: newScore,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.LOW }
    );
  }

  /**
   * Create court change event
   * @param {Object} match - Match object
   * @param {string} matchId - Match ID
   * @param {string} oldCourt - Previous court
   * @param {string} newCourt - New court
   * @returns {Object} Court change event
   */
  createCourtChangeEvent(match, matchId, oldCourt, newCourt) {
    const tournamentId = this.extractTournamentId(match);
    const players = this.extractPlayerNames(match);
    const description = `Court changed: ${players.join(' vs ')} moved from ${oldCourt} to ${newCourt}`;
    
    return createEvent(
      EVENT_TYPES.COURT_CHANGED,
      tournamentId,
      matchId,
      description,
      {
        players,
        previousCourt: oldCourt,
        currentCourt: newCourt,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.MEDIUM }
    );
  }

  /**
   * ATP Status code to event type mapping
   * ATP Status codes: C=Umpire on court, W=Warmup, P=In progress, S=Suspended, 
   * D=Toilet break, M=Medical timeout, R=Challenge in progress, E=Correction mode, F=Finished
   */
  getAtpStatusEventInfo(newStatus, oldStatus = null) {
    // Handle direct status mappings
    const statusEventMap = {
      'S': { type: EVENT_TYPES.MATCH_SUSPENDED, priority: EVENT_PRIORITY.HIGH },
      'M': { type: EVENT_TYPES.MEDICAL_TIMEOUT, priority: EVENT_PRIORITY.MEDIUM },
      'D': { type: EVENT_TYPES.TOILET_BREAK, priority: EVENT_PRIORITY.LOW },
      'R': { type: EVENT_TYPES.CHALLENGE_IN_PROGRESS, priority: EVENT_PRIORITY.MEDIUM },
      'E': { type: EVENT_TYPES.CORRECTION_MODE, priority: EVENT_PRIORITY.LOW },
      'C': { type: EVENT_TYPES.UMPIRE_ON_COURT, priority: EVENT_PRIORITY.MEDIUM },
      'W': { type: EVENT_TYPES.WARMUP_STARTED, priority: EVENT_PRIORITY.LOW }
    };

    // Handle status transitions
    if (oldStatus && newStatus !== oldStatus) {
      const transition = `${oldStatus}->${newStatus}`;
      switch (transition) {
      case 'S->P':
        return { type: EVENT_TYPES.MATCH_RESUMED, priority: EVENT_PRIORITY.HIGH };
      case 'D->P':
      case 'M->P':
      case 'R->P':
      case 'E->P':
        return { type: EVENT_TYPES.MATCH_RESUMED, priority: EVENT_PRIORITY.MEDIUM };
      case 'C->W':
        return { type: EVENT_TYPES.WARMUP_STARTED, priority: EVENT_PRIORITY.LOW };
      case 'W->P':
        return { type: EVENT_TYPES.MATCH_PLAY_BEGAN, priority: EVENT_PRIORITY.HIGH };
      }
    }

    // Use direct status mapping if available
    if (statusEventMap[newStatus]) {
      return statusEventMap[newStatus];
    }

    // Default to generic status change
    return { type: EVENT_TYPES.SCORE_UPDATED, priority: EVENT_PRIORITY.MEDIUM };
  }

  /**
   * Create status change event
   * @param {Object} match - Match object
   * @param {string} matchId - Match ID
   * @param {string} oldStatus - Previous status
   * @param {string} newStatus - New status
   * @returns {Object} Status change event
   */
  createStatusChangeEvent(match, matchId, oldStatus, newStatus) {
    const tournamentId = this.extractTournamentId(match);
    const players = this.extractPlayerNames(match);
    const statusInfo = this.getAtpStatusEventInfo(newStatus, oldStatus);
    
    let description = `Status change: ${players.join(' vs ')}`;
    
    // Create descriptive messages based on status
    switch (newStatus) {
    case 'C':
      description = `Umpire on court: ${players.join(' vs ')}`;
      break;
    case 'W':
      description = `Warmup started: ${players.join(' vs ')}`;
      break;
    case 'P':
      if (oldStatus === 'S') {
        description = `Match resumed: ${players.join(' vs ')}`;
      } else if (oldStatus === 'W') {
        description = `Match play began: ${players.join(' vs ')}`;
      } else {
        description = `Match in progress: ${players.join(' vs ')}`;
      }
      break;
    case 'S':
      description = `Match suspended: ${players.join(' vs ')}`;
      break;
    case 'D':
      description = `Toilet break: ${players.join(' vs ')}`;
      break;
    case 'M':
      description = `Medical timeout: ${players.join(' vs ')}`;
      break;
    case 'R':
      description = `Challenge in progress: ${players.join(' vs ')}`;
      break;
    case 'E':
      description = `Correction mode: ${players.join(' vs ')}`;
      break;
    case 'F':
      description = `Match finished: ${players.join(' vs ')}`;
      break;
    default:
      description = `Status change: ${players.join(' vs ')} - ${newStatus}`;
    }
    
    return createEvent(
      statusInfo.type,
      tournamentId,
      matchId,
      description,
      {
        players,
        previousStatus: oldStatus,
        currentStatus: newStatus,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: statusInfo.priority }
    );
  }

  /**
   * Create tiebreak started event
   * @param {Object} match - Match object
   * @param {string} matchId - Match ID
   * @returns {Object} Tiebreak started event
   */
  createTiebreakStartedEvent(match, matchId) {
    const tournamentId = this.extractTournamentId(match);
    const players = this.extractPlayerNames(match);
    const description = `Tiebreak started: ${players.join(' vs ')}`;
    
    return createEvent(
      EVENT_TYPES.TIEBREAK_STARTED,
      tournamentId,
      matchId,
      description,
      {
        players,
        currentScore: this.extractScore(match),
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.HIGH }
    );
  }

  /**
   * Process changes manually when using mixed ID fields
   * @param {string} endpoint - API endpoint path
   * @param {Object} previousData - Previous data
   * @param {Object} currentData - Current data
   * @returns {Array} Generated events
   */

  /**
   * Process draw changes (placeholder for future implementation)
   * @param {Array} changeset - Array of atomic changes
   * @param {Object} currentData - Current draw data
   * @returns {Array} Generated draw events
   */
  processDrawChanges(changeset, _currentData) {
    // Placeholder for future draw event detection using changeset
    console.log(`[EVENTS] Draw changes detected: ${changeset.length} changes`);
    return [];
  }

  /**
   * Determine the best key field to use for array comparison
   * @param {Array} matches - Array of match objects
   * @returns {string|null} Best key field name or null if none found
   */
  determineBestKeyField(matches) {
    if (!matches || matches.length === 0) {
      return 'MatchId'; // Default to production ATP API format
    }

    // Check for consistency of different ID field names across all matches
    // Order by preference: production format first, then common alternatives
    const keyFields = ['MatchId', 'matchId', 'id', 'Id', 'match_id'];
    
    for (const keyField of keyFields) {
      // Check if ALL matches have this field and it's unique
      const hasField = matches.every(match => match && match[keyField]);
      if (hasField) {
        // Check for uniqueness
        const values = matches.map(match => match[keyField]);
        const uniqueValues = new Set(values);
        if (uniqueValues.size === values.length) {
          return keyField; // Found a consistent, unique key field
        }
      }
    }

    // If we can't find a perfect match, use the most common ID field
    // Count how many matches use each field type
    const fieldCounts = {};
    keyFields.forEach(field => {
      fieldCounts[field] = matches.filter(match => match && match[field]).length;
    });
    
    // Return the field that appears in the most matches, defaulting to MatchId
    const mostCommonField = Object.keys(fieldCounts).reduce((a, b) => 
      fieldCounts[a] > fieldCounts[b] ? a : b, 'MatchId');
    
    return fieldCounts[mostCommonField] > 0 ? mostCommonField : 'MatchId';
  }

  // Keep existing utility methods from original implementation
  extractMatches(data) {
    if (!data) return [];
    
    if (Array.isArray(data)) {
      return data;
    }
    
    // Handle nested ATP API structure: TournamentMatches[0].Matches[n]
    if (data.TournamentMatches && Array.isArray(data.TournamentMatches)) {
      const allMatches = [];
      for (const tournament of data.TournamentMatches) {
        if (tournament.Matches && Array.isArray(tournament.Matches)) {
          // This is the nested structure - extract matches and preserve tournament context
          const matchesWithTournamentInfo = tournament.Matches.map(match => ({
            ...match,
            // Preserve tournament information from parent context
            _tournamentName: tournament.TournamentDisplayName,
            _tournamentId: tournament.TournamentId,
            _tournamentType: tournament.TournamentType,
            _tournamentLevel: tournament.TournamentLevel,
            _tournamentYear: tournament.TournamentYear
          }));
          allMatches.push(...matchesWithTournamentInfo);
        } else if (tournament.MatchId) {
          // This is the flat structure - tournament objects are actually matches
          allMatches.push(tournament);
        }
      }
      return allMatches;
    }
    
    console.warn('[EVENTS] Unable to extract matches from data structure:', Object.keys(data));
    return [];
  }

  createMatchMap(matches) {
    const map = new Map();
    
    matches.forEach(match => {
      const matchId = this.extractMatchId(match);
      if (matchId) {
        map.set(matchId, match);
      }
    });
    
    return map;
  }

  extractMatchId(match) {
    if (!match) return null;
    
    // ATP API format: MatchId field
    return match.MatchId || null;
  }

  extractTournamentId(match) {
    if(!match) return null;
    return match._tournamentId || null;
  }

  extractPlayerNames(match) {
    if (!match) return ['Unknown', 'Unknown'];
    
    // ATP API format: PlayerTeam1/PlayerTeam2 with PlayerFirstNameFull/PlayerLastName
    if (match.PlayerTeam1 && match.PlayerTeam2) {
      const player1Name = this.formatPlayerName(match.PlayerTeam1);
      const player2Name = this.formatPlayerName(match.PlayerTeam2);
      return [player1Name, player2Name];
    }
    
    return ['Unknown Player 1', 'Unknown Player 2'];
  }

  extractUmpireName(match) {
    if(!match) return 'Unknown Umpire';
    const firstName = match.UmpireFirstName || '';
    const lastName = match.UmpireLastName || '';
    return `${firstName} ${lastName}`.trim() || 'Unknown';
  }

  formatPlayerName(playerTeam) {
    if (!playerTeam) return 'Unknown';
    
    const firstName = playerTeam.PlayerFirstNameFull || playerTeam.PlayerFirstName || '';
    const lastName = playerTeam.PlayerLastName || '';
    
    // Handle doubles - if there's a partner, show both players. Use first initial only for space (PlayerFirstName)
    if (playerTeam.PartnerFirstName && playerTeam.PartnerLastName) {
      const partnerName = `${playerTeam.PartnerFirstName} ${playerTeam.PartnerLastName}`.trim();
      const mainPlayerName = `${firstName} ${lastName}`.trim();
      return `${mainPlayerName}/${partnerName}`;
    }
    
    return `${firstName} ${lastName}`.trim() || 'Unknown';
  }

  extractScore(match) {
    if (!match) return '0-0';
    
    // ATP API format: ResultString for formatted match score
    return match.ResultString || '0-0';
  }

  extractTournamentName(match) {
    if (!match) return 'Unknown Tournament';
    
    // Use preserved tournament information from parent TournamentMatches context
    return match._tournamentName || 'Unknown Tournament';
  }

  extractRound(match) {
    if (!match) return { ShortName: 'Unknown', LongName: 'Unknown Round' };
    
    // ATP API format: Round field (object with ShortName/LongName)
    return match.Round || { ShortName: 'Unknown', LongName: 'Unknown Round' };
  }

  extractStatus(match) {
    if (!match) return 'Unknown';
    
    // ATP API format: Status field (P=in progress, F=finished, etc.)
    return match.Status || 'Unknown';
  }

  deduplicateEvents(events) {
    if (!events || events.length === 0) return events;
    
    const seen = new Map();
    const deduplicated = [];
    
    for (const event of events) {
      // Create a unique key for each event type + match combination
      const key = `${event.event_type}:${event.match_id}`;
      
      if (!seen.has(key)) {
        seen.set(key, true);
        deduplicated.push(event);
      } else {
        console.log(`[EVENTS] Deduplicating: ${key}`);
      }
    }
    
    return deduplicated;
  }


  extractCourt(match) {
    if (!match) return 'Unknown Court';
    
    // ATP API format: CourtName field
    return match.CourtName || 'Unknown Court';
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
  }

  clearStates() {
    this.previousStates.clear();
    this.finishedMatches.clear();
  }

  getStats() {
    return {
      enabled: this.isEnabled,
      trackedEndpoints: Array.from(this.previousStates.keys()),
      totalStates: this.previousStates.size,
      implementation: 'json-diff-ts'
    };
  }
}

module.exports = new EventGeneratorService();
