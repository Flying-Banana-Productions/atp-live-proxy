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
   * @param {string} [timestamp] - Optional timestamp to use for events (defaults to current time)
   * @returns {Array} Generated events
   */
  processData(endpoint, currentData, timestamp = null) {
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
          events.push(...this.processLiveMatchChanges(changeset, currentData, previousData, timestamp));
          break;
        case '/api/draws/live':
          events.push(...this.processDrawChanges(changeset, currentData, previousData, timestamp));
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
          'Associations': '$index',
          'Events': '$index',
          'Rounds': '$index',
          'Fixtures': 'MatchCode'
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
  processLiveMatchChanges(changeset, currentData, previousData = null, timestamp = null) {
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
          const startedEvent = this.createMatchStartedEvent(match, timestamp);
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
          const finishedEvent = this.createMatchFinishedEvent(match, timestamp);
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
          const changeEvents = this.createEventFromFieldChanges(fieldChanges, currentMatch, matchId, timestamp);
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
  createEventFromMatchChange(change, matchMap, timestamp = null) {
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
            return [this.createMatchStartedEvent(value, timestamp)];
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
          return [this.createMatchFinishedEvent(value, timestamp)];
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
  createEventFromFieldChanges(changes, match, matchId, timestamp = null) {
    const events = [];
    
    // Process each field change and generate appropriate events
    for (const fieldChange of changes) {
      const { field: fieldName, oldValue, newValue } = fieldChange;

      let event = null;

      // Score changes
      if (fieldName === 'score') {
        // Check for special score events first
        if (this.isSetCompletion(oldValue, newValue)) {
          event = this.createSetCompletedEvent(match, matchId, oldValue, newValue, timestamp);
          // Fall back to score update if we couldn't reliably determine set winner
          if (!event) {
            event = this.createScoreUpdateEvent(match, matchId, oldValue, newValue, timestamp);
          }
        } else {
          // Regular score update
          event = this.createScoreUpdateEvent(match, matchId, oldValue, newValue, timestamp);
        }
      }

      // Court changes
      else if (fieldName === 'court') {
        event = this.createCourtChangeEvent(match, matchId, oldValue, newValue, timestamp);
      }

      // Status changes
      else if (fieldName === 'status') {
        // Special handling for 'F' (Finished) status
        if (newValue === 'F' && !this.finishedMatches.has(matchId)) {
          event = this.createMatchFinishedEvent(match, timestamp);
          if (event) {
            this.finishedMatches.add(matchId);
          }
        } else if (newValue !== 'F') {
          // For all other status changes, use the regular status change event
          event = this.createStatusChangeEvent(match, matchId, oldValue, newValue, timestamp);
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
    if (!score || typeof score !== 'string') {
      return null;
    }
    
    const sets = score.trim().split(/\s+/);
    
    // Find the most recently completed set (not "00")
    for (let i = sets.length - 1; i >= 0; i--) {
      const set = sets[i];
      if (set && set !== '00' && set.length >= 2) {
        const player1Games = parseInt(set[0]);
        const player2Games = parseInt(set[1]);
        
        // Basic validation - games should be reasonable tennis scores
        if (isNaN(player1Games) || isNaN(player2Games) || 
            player1Games < 0 || player2Games < 0 ||
            player1Games > 7 || player2Games > 7 ||
            (player1Games < 6 && player2Games < 6)) {
          return null;
        }
        
        return player1Games > player2Games ? 1 : 2;
      }
    }
    
    return null; // No valid completed set found
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
   * Create match started event
   * @param {Object} match - Match object
   * @returns {Object} Match started event
   */
  createMatchStartedEvent(match, timestamp = null) {
    const tournamentId = this.extractTournamentId(match);
    const matchId = this.extractMatchId(match);
    const playerNames = this.extractPlayerNames(match);
    const playerObjects = this.extractPlayersFromMatch(match);
    const description = `Match started: ${playerNames.join(' vs ')}`;
    
    return createEvent(
      EVENT_TYPES.MATCH_STARTED,
      tournamentId,
      matchId,
      description,
      {
        players: playerObjects,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match),
        court: this.extractCourt(match),
        initialScore: this.extractScore(match)
      },
      { priority: EVENT_PRIORITY.HIGH, timestamp }
    );
  }

  /**
   * Create match finished event
   * @param {Object} match - Match object
   * @param {Object} oldMatchData - Previous match data for context
   * @returns {Object} Match finished event
   */
  createMatchFinishedEvent(match, timestamp = null, oldMatchData = null) {
    const tournamentId = this.extractTournamentId(match);
    const matchId = this.extractMatchId(match);
    const playerNames = this.extractPlayerNames(match);
    const playerObjects = this.extractPlayersFromMatch(match);
    const finalScore = this.extractScore(oldMatchData || match);
    const description = `Match finished: ${playerNames.join(' vs ')} (${finalScore})`;
    
    return createEvent(
      EVENT_TYPES.MATCH_FINISHED,
      tournamentId,
      matchId,
      description,
      {
        players: playerObjects,
        finalScore,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.HIGH, timestamp }
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
  createScoreUpdateEvent(match, matchId, oldScore, newScore, timestamp = null) {
    const tournamentId = this.extractTournamentId(match);
    const playerNames = this.extractPlayerNames(match);
    const playerObjects = this.extractPlayersFromMatch(match);
    const description = `Score update: ${playerNames.join(' vs ')} - ${newScore}`;
    
    return createEvent(
      EVENT_TYPES.SCORE_UPDATED,
      tournamentId,
      matchId,
      description,
      {
        players: playerObjects,
        previousScore: oldScore,
        currentScore: newScore,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.MEDIUM, timestamp }
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
  createSetCompletedEvent(match, matchId, oldScore, newScore, timestamp = null) {
    const setWinner = this.getSetWinner(newScore);
    
    // Skip event generation if we can't reliably determine the winner
    if (setWinner === null) {
      return null;
    }
    
    const tournamentId = this.extractTournamentId(match);
    const playerNames = this.extractPlayerNames(match);
    const playerObjects = this.extractPlayersFromMatch(match);
    const description = `Set completed: ${playerNames.join(' vs ')} - ${newScore}`;
    
    return createEvent(
      EVENT_TYPES.SET_COMPLETED,
      tournamentId,
      matchId,
      description,
      {
        players: playerObjects,
        previousScore: oldScore,
        currentScore: newScore,
        setWinner,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.HIGH, timestamp }
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
  createCourtChangeEvent(match, matchId, oldCourt, newCourt, timestamp = null) {
    const tournamentId = this.extractTournamentId(match);
    const playerNames = this.extractPlayerNames(match);
    const playerObjects = this.extractPlayersFromMatch(match);
    const description = `Court changed: ${playerNames.join(' vs ')} moved from ${oldCourt} to ${newCourt}`;
    
    return createEvent(
      EVENT_TYPES.COURT_CHANGED,
      tournamentId,
      matchId,
      description,
      {
        players: playerObjects,
        previousCourt: oldCourt,
        currentCourt: newCourt,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: EVENT_PRIORITY.MEDIUM, timestamp }
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
  createStatusChangeEvent(match, matchId, oldStatus, newStatus, timestamp = null) {
    const tournamentId = this.extractTournamentId(match);
    const playerNames = this.extractPlayerNames(match);
    const playerObjects = this.extractPlayersFromMatch(match);
    const statusInfo = this.getAtpStatusEventInfo(newStatus, oldStatus);
    
    let description = `Status change: ${playerNames.join(' vs ')}`;
    
    // Create descriptive messages based on status
    switch (newStatus) {
    case 'C':
      description = `Umpire on court: ${playerNames.join(' vs ')}`;
      break;
    case 'W':
      description = `Warmup started: ${playerNames.join(' vs ')}`;
      break;
    case 'P':
      if (oldStatus === 'S') {
        description = `Match resumed: ${playerNames.join(' vs ')}`;
      } else if (oldStatus === 'W') {
        description = `Match play began: ${playerNames.join(' vs ')}`;
      } else {
        description = `Match in progress: ${playerNames.join(' vs ')}`;
      }
      break;
    case 'S':
      description = `Match suspended: ${playerNames.join(' vs ')}`;
      break;
    case 'D':
      description = `Toilet break: ${playerNames.join(' vs ')}`;
      break;
    case 'M':
      description = `Medical timeout: ${playerNames.join(' vs ')}`;
      break;
    case 'R':
      description = `Challenge in progress: ${playerNames.join(' vs ')}`;
      break;
    case 'E':
      description = `Correction mode: ${playerNames.join(' vs ')}`;
      break;
    case 'F':
      description = `Match finished: ${playerNames.join(' vs ')}`;
      break;
    default:
      description = `Status change: ${playerNames.join(' vs ')} - ${newStatus}`;
    }
    
    return createEvent(
      statusInfo.type,
      tournamentId,
      matchId,
      description,
      {
        players: playerObjects,
        previousStatus: oldStatus,
        currentStatus: newStatus,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority: statusInfo.priority, timestamp }
    );
  }


  /**
   * Create draw match result event (handles both normal completion and walkovers)
   * @param {Object} fixture - Draw fixture object
   * @param {Object} drawData - Original draw data
   * @returns {Object} Draw match result event
   */
  createDrawMatchResultEvent(fixture, drawData = null, timestamp = null) {
    if (!fixture || !fixture._context) return null;
    
    const tournamentId = fixture._context.tournamentId;
    const matchCode = fixture.MatchCode;
    const winner = fixture.Winner;
    const score = fixture.ResultString || 'Score not available';
    
    const { topPlayer, bottomPlayer } = this.extractPlayersFromFixture(fixture);
    
    // Handle both singles (object) and doubles (array)
    const formatPlayerNames = (player) => {
      if (Array.isArray(player)) {
        return player.map(p => p?.name).filter(n => n).join('/');
      }
      return player?.name || 'Unknown Player';
    };
    
    const topPlayerNames = formatPlayerNames(topPlayer);
    const bottomPlayerNames = formatPlayerNames(bottomPlayer);
    
    const playerNames = [topPlayerNames, bottomPlayerNames];
    
    const winnerName = winner === 1 ? playerNames[0] : playerNames[1];
    const winnerPlayer = winner === 1 ? topPlayer : bottomPlayer;
    
    // Determine result type
    const isWalkover = this.isWalkoverOrRetirement(score);
    const resultType = isWalkover ? 'walkover' : 'completed';
    
    // Build description based on result type
    const description = isWalkover 
      ? `Walkover: ${playerNames.join(' vs ')} - ${winnerName} advances (${score})`
      : `Draw match completed: ${playerNames.join(' vs ')} - ${winnerName} wins ${score}`;
    
    // Get enhanced tournament context
    const enhancedContext = this.createEnhancedTournamentContext(fixture, drawData);
    
    // Flatten players array for doubles
    const flattenPlayers = (player) => {
      if (Array.isArray(player)) return player;
      return player ? [player] : [];
    };
    
    return createEvent(
      EVENT_TYPES.DRAW_MATCH_RESULT,
      tournamentId,
      matchCode,
      description,
      {
        resultType,  // 'completed' or 'walkover'
        // Normalized player objects - flatten arrays for doubles
        players: [...flattenPlayers(topPlayer), ...flattenPlayers(bottomPlayer)].filter(p => p !== null),
        winner: winnerPlayer,
        score,
        // Enhanced tournament context
        tournament: enhancedContext?.tournament || {
          id: fixture._context.tournamentId,
          name: fixture._context.tournamentName,
          phase: 'main_draw',
          eventType: fixture._context.eventType,
          eventDescription: fixture._context.eventDescription
        },
        round: enhancedContext?.round || {
          name: fixture._context.roundName,
          code: this.getRoundCode(fixture._context.roundName, fixture._context.roundIdModernized)
        }
      },
      { priority: EVENT_PRIORITY.MEDIUM, timestamp }
    );
  }


  /**
   * Create draw player advanced event
   * @param {Object} currentFixture - Current fixture
   * @param {Object} previousFixture - Previous fixture
   * @returns {Object} Player advancement event
   */
  createDrawPlayerAdvancedEvent(currentFixture, previousFixture, drawData = null, timestamp = null) {
    if (!currentFixture || !currentFixture._context) return null;
    
    const tournamentId = currentFixture._context.tournamentId;
    const matchCode = currentFixture.MatchCode;
    
    let advancementType = 'unknown';
    let advancingPlayers = [];
    let description = '';
    
    // Extract player data based on which position became known
    if (!previousFixture.IsTopKnown && currentFixture.IsTopKnown) {
      advancementType = 'top';
      // Extract all players from DrawLineTop (advancing players are stored here, not in Result)
      if (currentFixture.DrawLineTop && currentFixture.DrawLineTop.Players && currentFixture.DrawLineTop.Players.length > 0) {
        const isDoubles = currentFixture.DrawLineTop.Players.length > 1;
        advancingPlayers = currentFixture.DrawLineTop.Players.map(player => {
          const playerData = this.extractPlayerDataFromDrawFields(player, isDoubles);
          return {
            name: playerData.fullName,
            playerId: player.PlayerId || null
          };
        });
      }
    } else if (!previousFixture.IsBottomKnown && currentFixture.IsBottomKnown) {
      advancementType = 'bottom';
      // Extract all players from DrawLineBottom
      if (currentFixture.DrawLineBottom && currentFixture.DrawLineBottom.Players && currentFixture.DrawLineBottom.Players.length > 0) {
        const isDoubles = currentFixture.DrawLineBottom.Players.length > 1;
        advancingPlayers = currentFixture.DrawLineBottom.Players.map(player => {
          const playerData = this.extractPlayerDataFromDrawFields(player, isDoubles);
          return {
            name: playerData.fullName,
            playerId: player.PlayerId || null
          };
        });
      }
    } else {
      return null;
    }
    
    // Create description with player names
    if (advancingPlayers.length === 1) {
      const playerName = advancingPlayers[0]?.name || 'Unknown player';
      description = `${playerName} advanced to ${advancementType} position in ${currentFixture._context.roundName}`;
    } else if (advancingPlayers.length > 1) {
      const playerNames = advancingPlayers.map(p => p.name).join(' / ');
      description = `${playerNames} advanced to ${advancementType} position in ${currentFixture._context.roundName}`;
    } else {
      description = `Unknown players advanced to ${advancementType} position in ${currentFixture._context.roundName}`;
    }
    
    // Get enhanced tournament context
    const enhancedContext = this.createEnhancedTournamentContext(currentFixture, drawData);
    
    return createEvent(
      EVENT_TYPES.DRAW_PLAYER_ADVANCED,
      tournamentId,
      matchCode,
      description,
      {
        players: advancingPlayers,  // Now includes all players who advanced (supports both singles and doubles)
        toRound: currentFixture._context.roundName,
        // Enhanced tournament context
        tournament: enhancedContext?.tournament || {
          id: currentFixture._context.tournamentId,
          name: currentFixture._context.tournamentName,
          phase: 'main_draw',
          eventType: currentFixture._context.eventType,
          eventDescription: currentFixture._context.eventDescription
        },
        round: enhancedContext?.round || {
          name: currentFixture._context.roundName,
          code: this.getRoundCode(currentFixture._context.roundName, currentFixture._context.roundIdModernized)
        },
        advancementType,
        position: advancementType === 'top' ? 'top' : 'bottom'
      },
      { priority: EVENT_PRIORITY.HIGH, timestamp }
    );
  }

  /**
   * Create draw round completed event
   * @param {string} roundName - Round name
   * @param {Array} fixtures - Completed fixtures
   * @returns {Object} Round completion event
   */
  createDrawRoundCompletedEvent(roundName, fixtures, drawData = null, timestamp = null) {
    if (!fixtures || fixtures.length === 0 || !fixtures[0]._context) return null;
    
    const context = fixtures[0]._context;
    const tournamentId = context.tournamentId;
    
    // Extract winner player objects
    const winnerPlayers = fixtures.map(fixture => {
      const winner = fixture.Winner;
      const { topPlayer, bottomPlayer } = this.extractPlayersFromFixture(fixture);
      return winner === 1 ? topPlayer : bottomPlayer;
    }).filter(player => player !== null);
    
    const description = `${roundName} completed in ${context.eventDescription} - ${winnerPlayers.length} winners advance`;
    
    // Get enhanced tournament context from first fixture
    const enhancedContext = this.createEnhancedTournamentContext(fixtures[0], drawData);
    
    return createEvent(
      EVENT_TYPES.DRAW_ROUND_COMPLETED,
      tournamentId,
      `round-${context.roundId}`,
      description,
      {
        round: roundName,
        winners: winnerPlayers,  // Now player objects instead of strings
        // Enhanced tournament context
        tournament: enhancedContext?.tournament || {
          id: context.tournamentId,
          name: context.tournamentName,
          phase: 'main_draw',
          eventType: context.eventType,
          eventDescription: context.eventDescription
        },
        roundDetails: enhancedContext?.round || {
          name: roundName,
          code: this.getRoundCode(roundName, context.roundIdModernized)
        },
        matchesCompleted: fixtures.length
      },
      { priority: EVENT_PRIORITY.HIGH, timestamp }
    );
  }



  /**
   * Create draw tournament completed event
   * @param {Object} fixture - Final fixture
   * @returns {Object} Tournament completion event
   */
  createDrawTournamentCompletedEvent(fixture, drawData = null, timestamp = null) {
    if (!fixture || !fixture._context || fixture.Winner === 0) return null;
    
    const tournamentId = fixture._context.tournamentId;
    const winner = fixture.Winner;
    const score = fixture.ResultString || 'Score not available';
    
    const { topPlayer, bottomPlayer } = this.extractPlayersFromFixture(fixture);
    
    const champion = winner === 1 ? topPlayer : bottomPlayer;
    const finalist = winner === 1 ? bottomPlayer : topPlayer;
    const description = `Tournament completed: ${champion?.name || 'Unknown'} wins ${fixture._context.eventDescription} - ${score}`;
    
    // Get enhanced tournament context
    const enhancedContext = this.createEnhancedTournamentContext(fixture, drawData);
    
    return createEvent(
      EVENT_TYPES.DRAW_TOURNAMENT_COMPLETED,
      tournamentId,
      fixture.MatchCode,
      description,
      {
        champion,  // Now player object instead of string
        finalist,  // Now player object instead of string
        finalScore: score,
        // Enhanced tournament context
        tournament: enhancedContext?.tournament || {
          id: fixture._context.tournamentId,
          name: fixture._context.tournamentName,
          phase: 'main_draw',
          eventType: fixture._context.eventType,
          eventDescription: fixture._context.eventDescription
        }
      },
      { priority: EVENT_PRIORITY.CRITICAL }
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
   * Extract all fixtures from draw data structure
   * @param {Object} drawData - Draw data from ATP API
   * @returns {Array} Array of all fixtures with context
   */
  extractDrawFixtures(drawData) {
    if (!drawData || !drawData.Associations) {
      return [];
    }

    const allFixtures = [];
    for (const association of drawData.Associations) {
      if (association.Events) {
        for (const event of association.Events) {
          if (event.Rounds) {
            for (const round of event.Rounds) {
              if (round.Fixtures) {
                for (const fixture of round.Fixtures) {
                  // Add context information to fixture
                  allFixtures.push({
                    ...fixture,
                    _context: {
                      tournamentId: association.TournamentId,
                      tournamentName: drawData.Location,
                      eventType: event.EventTypeCode,
                      eventDescription: event.Description,
                      roundId: round.RoundId,
                      roundName: round.RoundName,
                      roundIdModernized: round.RoundIdModernized
                    }
                  });
                }
              }
            }
          }
        }
      }
    }
    
    
    return allFixtures;
  }

  /**
   * Create fixture map keyed by MatchCode
   * @param {Array} fixtures - Array of fixtures
   * @returns {Map} Map of fixtures keyed by MatchCode
   */
  createDrawFixtureMap(fixtures) {
    const map = new Map();
    
    fixtures.forEach(fixture => {
      if (fixture.MatchCode) {
        map.set(fixture.MatchCode, fixture);
      }
    });
    
    return map;
  }

  /**
   * Extract player information from fixture team
   * @param {Object} team - Team object (TeamTop or TeamBottom)
   * @param {number} teamId - Team identifier (1 for top, 2 for bottom)
   * @returns {Object|Array} Player information - array for doubles, single object for singles
   */
  extractPlayerFromTeam(team, teamId) {
    if (!team || !team.Player) return null;
    
    const player = team.Player;
    const isDoubles = Boolean(team.Partner);
    
    // Use first initial for doubles matches to save space
    const playerData = this.extractPlayerDataFromDrawFields(player, isDoubles);
    
    const playerObj = {
      name: playerData.fullName,
      playerId: player.PlayerId || null,
      teamId
    };
    
    // Check if this is a doubles match (has Partner)
    if (team.Partner) {
      const partner = team.Partner;
      const partnerData = this.extractPlayerDataFromDrawFields(partner, isDoubles);
      
      const partnerObj = {
        name: partnerData.fullName,
        playerId: partner.PlayerId || null,
        teamId
      };
      
      // Return array of both players for doubles
      return [playerObj, partnerObj];
    }
    
    // Return single player for singles
    return playerObj;
  }

  /**
   * Extract players from fixture result
   * @param {Object} fixture - Draw fixture object
   * @returns {Object} Object with topPlayer and bottomPlayer
   */
  extractPlayersFromFixture(fixture) {
    if (!fixture || !fixture.Result) {
      return { topPlayer: null, bottomPlayer: null };
    }
    
    return {
      topPlayer: this.extractPlayerFromTeam(fixture.Result.TeamTop, 1),
      bottomPlayer: this.extractPlayerFromTeam(fixture.Result.TeamBottom, 2)
    };
  }

  /**
   * Format draw player name from player object (for draw events)
   * @param {Object} player - Player object from draw fixture
   * @returns {string} Formatted player name
   */
  formatDrawPlayerName(player) {
    if (!player) return 'Unknown';
    
    const firstName = player.FirstName || '';
    const lastName = player.LastName || '';
    const fullName = `${firstName} ${lastName}`.trim();
    
    return fullName || 'Unknown';
  }

  /**
   * Check if a match result represents a walkover or retirement
   * @param {string} resultString - Match result string
   * @returns {boolean} True if walkover/retirement
   */
  isWalkoverOrRetirement(resultString) {
    if (!resultString) return false;
    
    const result = resultString.toUpperCase();
    return result.includes('W.O.') || 
           result.includes('RET') || 
           result.includes('WALKOVER') ||
           result.includes('RETIRED');
  }

  /**
   * Determine if all matches in a round are completed
   * @param {Array} fixtures - Fixtures for a specific round
   * @returns {boolean} True if round is complete
   */
  isRoundCompleted(fixtures) {
    if (!fixtures || fixtures.length === 0) return false;
    
    return fixtures.every(fixture => 
      fixture.Winner !== undefined && fixture.Winner !== 0
    );
  }

  /**
   * Process draw changes using fixture comparison
   * @param {Array} changeset - Array of atomic changes (for compatibility)
   * @param {Object} currentData - Current draw data
   * @param {Object} previousData - Previous draw data for comparison
   * @returns {Array} Generated draw events
   */
  processDrawChanges(changeset, currentData, previousData = null, timestamp = null) {
    const events = [];
    
    // Get previous data for comparison - use parameter if provided, otherwise fallback to state
    if (!previousData) {
      previousData = this.previousStates.get('/api/draws/live');
      if (!previousData) {
        console.log('[EVENTS] No previous draw data for comparison, skipping event generation');
        return events;
      }
    }

    // Extract fixtures from both datasets
    const previousFixtures = this.extractDrawFixtures(previousData);
    const currentFixtures = this.extractDrawFixtures(currentData);
    
    // Create maps for efficient comparison
    const previousFixtureMap = this.createDrawFixtureMap(previousFixtures);
    const currentFixtureMap = this.createDrawFixtureMap(currentFixtures);
    
    // Compare fixtures for changes
    for (const [matchCode, currentFixture] of currentFixtureMap) {
      const previousFixture = previousFixtureMap.get(matchCode);
      
      if (previousFixture) {
        // Check for match completion (normal or walkover)
        if (previousFixture.Winner === 0 && currentFixture.Winner !== 0) {
          const matchResultEvent = this.createDrawMatchResultEvent(currentFixture, currentData, timestamp);
          if (matchResultEvent) events.push(matchResultEvent);
        }
        
        // Check for player advancement (IsTopKnown/IsBottomKnown changes)
        if ((!previousFixture.IsTopKnown && currentFixture.IsTopKnown) ||
            (!previousFixture.IsBottomKnown && currentFixture.IsBottomKnown)) {
          const advancementEvent = this.createDrawPlayerAdvancedEvent(currentFixture, previousFixture, currentData, timestamp);
          if (advancementEvent) events.push(advancementEvent);
        }
      }
    }
    
    // Check for round completion and special draw events
    const roundEvents = this.checkForRoundCompletionEvents(currentFixtures, previousFixtures, currentData, timestamp);
    events.push(...roundEvents);
    
    console.log(`[EVENTS] Generated ${events.length} draw events`);
    return events;
  }

  /**
   * Check for round completion and tournament progression events
   * @param {Array} currentFixtures - Current fixtures
   * @param {Array} previousFixtures - Previous fixtures
   * @param {Object} drawData - Original draw data
   * @returns {Array} Round/tournament completion events
   */
  checkForRoundCompletionEvents(currentFixtures, previousFixtures, drawData = null, timestamp = null) {
    const events = [];
    
    // Group fixtures by round
    const currentRounds = this.groupFixturesByRound(currentFixtures);
    const previousRounds = this.groupFixturesByRound(previousFixtures);
    
    for (const [roundName, fixtures] of currentRounds) {
      const previousRoundFixtures = previousRounds.get(roundName) || [];
      
      // Check if round just completed
      const wasRoundComplete = this.isRoundCompleted(previousRoundFixtures);
      const isRoundComplete = this.isRoundCompleted(fixtures);
      
      if (!wasRoundComplete && isRoundComplete) {
        const roundEvent = this.createDrawRoundCompletedEvent(roundName, fixtures, drawData, timestamp);
        if (roundEvent) events.push(roundEvent);
        
        // Check for tournament final completion
        if (roundName.toLowerCase().includes('final') && fixtures.length === 1) {
          const tournamentEvent = this.createDrawTournamentCompletedEvent(fixtures[0], drawData, timestamp);
          if (tournamentEvent) events.push(tournamentEvent);
        }
      }
    }
    
    return events;
  }

  /**
   * Create enhanced tournament context from fixture context and draw data
   * @param {Object} fixture - Fixture with _context
   * @param {Object} drawData - Original draw data (optional)
   * @returns {Object} Enhanced tournament context
   */
  createEnhancedTournamentContext(fixture, drawData = null) {
    if (!fixture._context) return null;
    
    const context = fixture._context;
    
    // Determine tournament phase based on event type
    const isQualifying = context.eventType === 'QS' || 
                        context.eventDescription?.toLowerCase().includes('qualifying');
    
    // Extract round code from round name and modernized ID
    const roundCode = this.getRoundCode(context.roundName, context.roundIdModernized);
    
    // Calculate stage number (rounds from final)
    const stage = this.getStageFromRoundId(context.roundIdModernized);
    
    // Extract draw size from draw data if available
    let drawSize = null;
    if (drawData && drawData.Associations) {
      for (const association of drawData.Associations) {
        if (association.TournamentId === context.tournamentId) {
          for (const event of association.Events) {
            if (event.EventTypeCode === context.eventType) {
              drawSize = event.DrawSize;
              break;
            }
          }
          if (drawSize) break;
        }
      }
    }
    
    return {
      tournament: {
        id: context.tournamentId,
        name: context.tournamentName,
        phase: isQualifying ? 'qualifying' : 'main_draw',
        drawSize,
        eventType: context.eventType,
        eventDescription: context.eventDescription
      },
      round: {
        id: context.roundId,
        name: context.roundName,
        code: roundCode,
        modernizedId: context.roundIdModernized,
        stage
      }
    };
  }
  
  /**
   * Get standardized round code from round name and modernized ID
   * @param {string} roundName - Round name from API
   * @param {number} modernizedId - Modernized round ID
   * @returns {string} Standardized round code
   */
  getRoundCode(roundName, modernizedId) {
    if (!roundName) return 'R0';
    
    const name = roundName.toLowerCase();
    
    // Handle standard round names
    if (name.includes('final') && !name.includes('semifinal')) return 'F';
    if (name.includes('semifinal')) return 'SF';
    if (name.includes('quarterfinal')) return 'QF';
    if (name.includes('round of 16')) return 'R16';
    if (name.includes('round of 32')) return 'R32';
    if (name.includes('round of 64')) return 'R64';
    if (name.includes('round of 128')) return 'R128';
    
    // Handle qualifying rounds
    if (name.includes('qualifying')) {
      if (name.includes('round 1') || name.includes('first round')) return 'Q1';
      if (name.includes('round 2') || name.includes('second round')) return 'Q2';
      if (name.includes('round 3') || name.includes('third round')) return 'Q3';
      return 'Q';
    }
    
    // Fall back to modernized ID mapping if available
    if (modernizedId) {
      const idToCode = {
        8: 'F',    // Final
        7: 'SF',   // Semifinal  
        6: 'QF',   // Quarterfinal
        5: 'R16',  // Round of 16
        4: 'R32',  // Round of 32
        3: 'R64',  // Round of 64
        2: 'R128', // Round of 128
        1: 'R256'  // First round (rare)
      };
      return idToCode[modernizedId] || `R${modernizedId}`;
    }
    
    return 'R0'; // Default fallback
  }
  
  /**
   * Calculate stage number (rounds from final)
   * @param {number} modernizedId - Modernized round ID  
   * @returns {number} Stage number (1 = final, 2 = semifinal, etc.)
   */
  getStageFromRoundId(modernizedId) {
    if (!modernizedId) return 0;
    
    // Modernized ID 8 = final (stage 1), 7 = semifinal (stage 2), etc.
    return Math.max(1, 9 - modernizedId);
  }

  /**
   * Group fixtures by round name
   * @param {Array} fixtures - Array of fixtures
   * @returns {Map} Map of round name to fixtures
   */
  groupFixturesByRound(fixtures) {
    const rounds = new Map();
    
    fixtures.forEach(fixture => {
      const roundName = fixture._context?.roundName || 'Unknown Round';
      
      if (!rounds.has(roundName)) {
        rounds.set(roundName, []);
      }
      
      rounds.get(roundName).push(fixture);
    });
    
    return rounds;
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

  /**
   * Extract player data from player fields with optional first initial mode
   * @param {Object} playerData - Player data object with name fields
   * @param {boolean} useFirstInitial - Use PlayerFirstName (first initial) instead of PlayerFirstNameFull
   * @returns {Object} {firstName, lastName, fullName}
   */
  extractPlayerDataFromFields(playerData, useFirstInitial = false) {
    if (!playerData) return { firstName: '', lastName: '', fullName: 'Unknown' };
    
    const firstName = useFirstInitial ? 
      (playerData.PlayerFirstName || '') : 
      (playerData.PlayerFirstNameFull || playerData.PlayerFirstName || '');
    const lastName = playerData.PlayerLastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
    
    return { firstName, lastName, fullName };
  }

  /**
   * Extract partner data from team object
   * @param {Object} playerTeam - Team object containing partner fields
   * @param {boolean} useFirstInitial - Use first initial instead of full first name
   * @returns {Object} {firstName, lastName, fullName}
   */
  extractPartnerData(playerTeam, useFirstInitial = false) {
    if (!playerTeam || (!playerTeam.PartnerFirstName && !playerTeam.PartnerLastName)) {
      return { firstName: '', lastName: '', fullName: '' };
    }
    
    // Choose between first initial and full name based on parameter
    const fullFirstName = playerTeam.PartnerFirstNameFull || playerTeam.PartnerFirstName || '';
    const firstName = useFirstInitial && fullFirstName ? `${fullFirstName.charAt(0)}.` : fullFirstName;
    const lastName = playerTeam.PartnerLastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
    
    return { firstName, lastName, fullName };
  }

  /**
   * Extract player data from draw fixture fields with optional first initial mode
   * @param {Object} playerData - Draw player data object with FirstName/LastName fields
   * @param {boolean} useFirstInitial - Use first initial instead of full first name
   * @returns {Object} {firstName, lastName, fullName}
   */
  extractPlayerDataFromDrawFields(playerData, useFirstInitial = false) {
    if (!playerData) return { firstName: '', lastName: '', fullName: 'Unknown' };
    
    const fullFirstName = playerData.FirstName || '';
    const firstName = useFirstInitial && fullFirstName ? `${fullFirstName.charAt(0)}.` : fullFirstName;
    const lastName = playerData.LastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
    
    return { firstName, lastName, fullName };
  }

  extractPlayerNames(match) {
    if (!match) return ['Unknown', 'Unknown'];
    
    // ATP API format: PlayerTeam1/PlayerTeam2 with PlayerFirstNameFull/PlayerLastName
    if (match.PlayerTeam1 && match.PlayerTeam2) {
      // Detect if this is doubles by checking if either team has a partner
      const isDoubles = Boolean(match.PlayerTeam1.PartnerId || match.PlayerTeam2.PartnerId);
      
      // Use the shared helper functions for consistency
      const formatPlayerTeam = (playerTeam) => {
        if (!playerTeam) return 'Unknown';
        
        // For doubles, use first initials to save space; for singles, use full names
        const useFirstInitial = isDoubles;
        const playerData = this.extractPlayerDataFromFields(playerTeam, useFirstInitial);
        
        // Handle doubles - if there's a partner, show both players with consistent naming
        const partnerData = this.extractPartnerData(playerTeam, useFirstInitial);
        if (partnerData.fullName) {
          return `${playerData.fullName}/${partnerData.fullName}`;
        }
        
        return playerData.fullName;
      };
      
      const player1Name = formatPlayerTeam(match.PlayerTeam1);
      const player2Name = formatPlayerTeam(match.PlayerTeam2);
      return [player1Name, player2Name];
    }
    
    return ['Unknown Player 1', 'Unknown Player 2'];
  }

  /**
   * Extract structured player objects from live match data (for live match events)
   * @param {Object} match - Live match object
   * @returns {Array} Array of player objects with {name, playerId, teamId} structure
   */
  extractPlayersFromMatch(match) {
    if (!match) return [];
    
    const players = [];
    
    // Extract PlayerTeam1 with teamId: 1
    if (match.PlayerTeam1) {
      const team1Players = this.extractPlayerObjectsFromTeam(match.PlayerTeam1, 1);
      players.push(...team1Players);
    }
    
    // Extract PlayerTeam2 with teamId: 2
    if (match.PlayerTeam2) {
      const team2Players = this.extractPlayerObjectsFromTeam(match.PlayerTeam2, 2);
      players.push(...team2Players);
    }
    
    return players.length > 0 ? players : [];
  }

  /**
   * Extract player objects from a team (handles both singles and doubles)
   * @param {Object} playerTeam - PlayerTeam object from live match
   * @param {number} teamId - Team identifier (1 for first team, 2 for second team)
   * @returns {Array} Array of player objects
   */
  extractPlayerObjectsFromTeam(playerTeam, teamId = null) {
    if (!playerTeam) return [];
    
    const players = [];
    
    // Main player
    if (playerTeam.PlayerId) {
      // use first initial if doubles match (when partner exists)
      const useFirstInitial = Boolean(playerTeam.PartnerId);
      const playerData = this.extractPlayerDataFromFields(playerTeam, useFirstInitial);
      
      const playerObj = {
        name: playerData.fullName,
        playerId: playerTeam.PlayerId
      };
      
      // Add teamId if provided for consistency with draw events
      if (teamId !== null) {
        playerObj.teamId = teamId;
      }
      
      players.push(playerObj);
    }
    
    // Partner (for doubles)
    if (playerTeam.PartnerId) {
      const useFirstInitial = Boolean(playerTeam.PartnerId); // Same logic as main player
      const partnerData = this.extractPartnerData(playerTeam, useFirstInitial);
      
      const partnerObj = {
        name: partnerData.fullName,
        playerId: playerTeam.PartnerId
      };
      
      // Add teamId if provided for consistency with draw events
      if (teamId !== null) {
        partnerObj.teamId = teamId;
      }
      
      players.push(partnerObj);
    }
    
    return players;
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
