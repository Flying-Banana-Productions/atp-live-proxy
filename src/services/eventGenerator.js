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
      console.log(`[EVENTS] First poll for ${endpoint}, storing initial state`);
      return events;
    }

    try {
      // Generate diff with match-specific configuration
      const diffOptions = this.getDiffOptions(endpoint, currentData, previousData);
      const changeset = diff(previousData, currentData, diffOptions);

      if (changeset && changeset.length > 0) {
        console.log(`[EVENTS] Detected ${changeset.length} changes for ${endpoint}`);
        
        // Process changes based on endpoint type
        switch (endpoint) {
          case '/api/live-matches':
            events.push(...this.processLiveMatchChanges(changeset, currentData));
            break;
          case '/api/draws/live':
            events.push(...this.processDrawChanges(changeset, currentData));
            break;
          default:
            console.log(`[EVENTS] No change handler for endpoint: ${endpoint}`);
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
      case '/api/live-matches':
        // Determine the best key field to use based on actual data from both current and previous
        const currentMatches = this.extractMatches(currentData || {});
        const previousMatches = this.extractMatches(previousData || {});
        const allMatches = [...currentMatches, ...previousMatches];
        const keyField = this.determineBestKeyField(allMatches);
        
        console.log(`[EVENTS] determineBestKeyField returned: ${keyField} for ${allMatches.length} matches`);
        
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
   * Process live match changes from JSON diff changeset
   * @param {Array} changeset - Array of atomic changes
   * @param {Object} currentData - Current match data for context
   * @returns {Array} Generated match events
   */
  processLiveMatchChanges(changeset, currentData) {
    const events = [];
    const currentMatches = this.extractMatches(currentData);
    const matchMap = this.createMatchMap(currentMatches);
    
    for (const change of changeset) {
      try {
        // Handle nested changeset structure from json-diff-ts
        if (change.type === 'UPDATE' && change.changes) {
          // Handle different container names (TournamentMatches, matches, data, or root array)
          const containerKey = change.key;
          if (containerKey === 'TournamentMatches' || containerKey === 'matches' || containerKey === 'data' || !containerKey) {
            for (const subChange of change.changes) {
              // For nested ATP structure, check if this is changes to a Matches array
              if (subChange.type === 'UPDATE' && subChange.key === 'Matches' && subChange.changes) {
                // This is changes to the Matches array within a tournament
                for (const matchChange of subChange.changes) {
                  const matchEvents = this.createEventFromMatchChange(matchChange, matchMap);
                  if (matchEvents && matchEvents.length > 0) {
                    events.push(...matchEvents);
                  }
                }
              } 
              // For nested structure, check if this is a tournament change that contains Matches changes
              else if (subChange.type === 'UPDATE' && /^\d+$/.test(subChange.key) && subChange.changes) {
                // This could be a tournament index change - check if it contains Matches changes
                for (const tournamentChange of subChange.changes) {
                  if (tournamentChange.type === 'UPDATE' && tournamentChange.key === 'Matches' && tournamentChange.changes) {
                    // This is the nested structure: TournamentMatches[0].Matches changes
                    for (const matchChange of tournamentChange.changes) {
                      const matchEvents = this.createEventFromMatchChange(matchChange, matchMap);
                      if (matchEvents && matchEvents.length > 0) {
                        events.push(...matchEvents);
                      }
                    }
                  } else {
                    // This is a direct match change in the flat structure (TournamentMatches[0] is a match)
                    const matchEvents = this.createEventFromMatchChange(tournamentChange, matchMap);
                    if (matchEvents && matchEvents.length > 0) {
                      events.push(...matchEvents);
                    }
                  }
                }
              } 
              // Handle other direct changes (ADD/REMOVE etc.)
              else {
                const subEvents = this.createEventFromMatchChange(subChange, matchMap);
                if (subEvents && subEvents.length > 0) {
                  events.push(...subEvents);
                }
              }
            }
          }
        }
        // Handle direct array changes (when data is an array at root level)
        else if ((change.type === 'ADD' || change.type === 'REMOVE') && change.value) {
          const event = change.type === 'ADD' 
            ? this.createMatchStartedEvent(change.value)
            : this.createMatchFinishedEvent(change.value);
          if (event) {
            events.push(event);
          }
        }
      } catch (error) {
        console.error('[EVENTS] Error creating event from change:', error.message);
      }
    }

    // Deduplicate events to prevent multiple events for the same match in one cycle
    const deduplicatedEvents = this.deduplicateEvents(events);
    
    console.log(`[EVENTS] events generated (${events.length} -> ${deduplicatedEvents.length} after deduplication): ${JSON.stringify(deduplicatedEvents, null, 2)}`);
    return deduplicatedEvents;
  }

  /**
   * Create specific events from a match-level change
   * @param {Object} change - Match change from json-diff-ts
   * @param {Map} matchMap - Map of current matches by ID
   * @returns {Array} Array of generated events
   */
  createEventFromMatchChange(change, matchMap) {
    const { type, key, value, oldValue, changes } = change;

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
   * Create events from field-level changes within a match
   * @param {Array} changes - Array of field changes from json-diff-ts
   * @param {Object} match - Current match object
   * @param {string} matchId - Match identifier
   * @returns {Array} Array of generated events
   */
  createEventFromFieldChanges(changes, match, matchId) {
    const events = [];
    
    // Process each field change and generate appropriate events
    for (const fieldChange of changes) {
      const { type, key: fieldName, value: newValue, oldValue } = fieldChange;

      if (type !== 'UPDATE') continue;

      let event = null;

      // MatchId changes indicate a match replacement (remove old + add new)
      if (fieldName === 'MatchId' || fieldName === 'matchId' || fieldName === 'id' || fieldName === 'match_id') {
        console.log(`[EVENTS] MatchId change detected: ${oldValue} -> ${newValue}`);
        
        // Create finished event for old match
        const oldMatch = { ...match, [fieldName]: oldValue };
        const finishedEvent = this.createMatchFinishedEvent(oldMatch);
        if (finishedEvent) events.push(finishedEvent);
        
        // Create started event for new match - but only if it's actually in progress
        const matchStatus = this.extractStatus(match);
        if (matchStatus !== 'F' && matchStatus !== 'finished') {
          const startedEvent = this.createMatchStartedEvent(match);
          if (startedEvent) events.push(startedEvent);
        } else {
          console.log(`[EVENTS] Skipping match started event for ${newValue} - match is already finished (status: ${matchStatus})`);
        }
        continue; // Skip other processing for this change
      }

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
      else if (fieldName === 'court' || fieldName === 'courtName' || fieldName === 'venue') {
        event = this.createCourtChangeEvent(match, matchId, oldValue, newValue);
      }

      // Status changes
      else if (fieldName === 'status') {
        event = this.createStatusChangeEvent(match, matchId, oldValue, newValue);
      }

      if (event) {
        events.push(event);
      }
    }

    return events;
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
    
    // Detect set completion patterns: 6-4, 6-3, 6-2, 6-1, 6-0, 7-5, 7-6, 6-7, 5-7, etc.
    const setWinPatterns = [
      /\b6-[0-4]\b/, /\b[0-4]-6\b/,  // 6-0 to 6-4
      /\b7-5\b/, /\b5-7\b/,           // 7-5
      /\b7-6\b/, /\b6-7\b/            // 7-6 (tiebreak)
    ];
    
    const oldHasSetWin = setWinPatterns.some(pattern => pattern.test(oldScore));
    const newHasSetWin = setWinPatterns.some(pattern => pattern.test(newScore));
    
    return !oldHasSetWin && newHasSetWin;
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
    const matchId = this.extractMatchId(match);
    const players = this.extractPlayerNames(match);
    const description = `Match started: ${players.join(' vs ')}`;
    
    return createEvent(
      EVENT_TYPES.MATCH_STARTED,
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
    const matchId = this.extractMatchId(match);
    const players = this.extractPlayerNames(match);
    const finalScore = this.extractScore(oldMatchData || match);
    const description = `Match finished: ${players.join(' vs ')} (${finalScore})`;
    
    return createEvent(
      EVENT_TYPES.MATCH_FINISHED,
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
    const players = this.extractPlayerNames(match);
    const description = `Score update: ${players.join(' vs ')} - ${newScore}`;
    
    return createEvent(
      EVENT_TYPES.SCORE_UPDATED,
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
   * @param {string} matchId - Match ID
   * @param {string} oldScore - Previous score
   * @param {string} newScore - New score
   * @returns {Object} Set completed event
   */
  createSetCompletedEvent(match, matchId, oldScore, newScore) {
    const players = this.extractPlayerNames(match);
    const description = `Set completed: ${players.join(' vs ')} - ${newScore}`;
    
    return createEvent(
      EVENT_TYPES.SET_COMPLETED,
      matchId,
      description,
      {
        players,
        previousScore: oldScore,
        currentScore: newScore,
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
    const players = this.extractPlayerNames(match);
    const description = `Game completed: ${players.join(' vs ')} - ${newScore}`;
    
    return createEvent(
      EVENT_TYPES.GAME_WON,
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
    const players = this.extractPlayerNames(match);
    const description = `Court changed: ${players.join(' vs ')} moved from ${oldCourt} to ${newCourt}`;
    
    return createEvent(
      EVENT_TYPES.COURT_CHANGED,
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
   * Create status change event
   * @param {Object} match - Match object
   * @param {string} matchId - Match ID
   * @param {string} oldStatus - Previous status
   * @param {string} newStatus - New status
   * @returns {Object} Status change event
   */
  createStatusChangeEvent(match, matchId, oldStatus, newStatus) {
    const players = this.extractPlayerNames(match);
    let eventType = EVENT_TYPES.SCORE_UPDATED;
    let priority = EVENT_PRIORITY.MEDIUM;

    // Determine specific event type based on status
    if (newStatus && typeof newStatus === 'string') {
      const status = newStatus.toLowerCase();
      if (status.includes('suspended')) {
        eventType = EVENT_TYPES.MATCH_SUSPENDED;
        priority = EVENT_PRIORITY.HIGH;
      } else if (status.includes('resumed')) {
        eventType = EVENT_TYPES.MATCH_RESUMED;
        priority = EVENT_PRIORITY.HIGH;
      } else if (status.includes('retired')) {
        eventType = EVENT_TYPES.PLAYER_RETIRED;
        priority = EVENT_PRIORITY.CRITICAL;
      } else if (status.includes('delay')) {
        eventType = EVENT_TYPES.MATCH_DELAYED;
        priority = EVENT_PRIORITY.HIGH;
      } else if (status.includes('medical')) {
        eventType = EVENT_TYPES.MEDICAL_TIMEOUT;
        priority = EVENT_PRIORITY.MEDIUM;
      }
    }

    const description = `Status change: ${players.join(' vs ')} - ${newStatus}`;
    
    return createEvent(
      eventType,
      matchId,
      description,
      {
        players,
        previousStatus: oldStatus,
        currentStatus: newStatus,
        tournament: this.extractTournamentName(match),
        round: this.extractRound(match)
      },
      { priority }
    );
  }

  /**
   * Create tiebreak started event
   * @param {Object} match - Match object
   * @param {string} matchId - Match ID
   * @returns {Object} Tiebreak started event
   */
  createTiebreakStartedEvent(match, matchId) {
    const players = this.extractPlayerNames(match);
    const description = `Tiebreak started: ${players.join(' vs ')}`;
    
    return createEvent(
      EVENT_TYPES.TIEBREAK_STARTED,
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
  processDrawChanges(changeset, currentData) {
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
      // Check if this is the nested structure with Matches arrays inside each tournament
      const allMatches = [];
      for (const tournament of data.TournamentMatches) {
        if (tournament.Matches && Array.isArray(tournament.Matches)) {
          // This is the nested structure - extract matches from each tournament
          allMatches.push(...tournament.Matches);
        } else if (this.extractMatchId(tournament)) {
          // This is the flat structure - tournament objects are actually matches
          // Use extractMatchId to handle different ID field names (MatchId, matchId, etc.)
          allMatches.push(tournament);
        }
      }
      return allMatches;
    }
    
    if (data.matches && Array.isArray(data.matches)) {
      return data.matches;
    }
    
    if (data.data && Array.isArray(data.data)) {
      return data.data;
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
    return match.MatchId || 
           match.matchId || 
           match.id || 
           match.Id ||
           match.match_id ||
           null;
  }

  extractPlayerNames(match) {
    if (!match) return ['Unknown', 'Unknown'];
    
    // ATP API format: PlayerTeam1/PlayerTeam2 with PlayerFirstName/PlayerLastName
    if (match.PlayerTeam1 && match.PlayerTeam2) {
      const player1Name = this.formatPlayerName(match.PlayerTeam1);
      const player2Name = this.formatPlayerName(match.PlayerTeam2);
      return [player1Name, player2Name];
    }
    
    // Legacy/test format: players array with name property
    if (match.players && Array.isArray(match.players)) {
      return match.players.map(p => p.name || p.lastName || p.displayName || 'Unknown');
    }
    
    // Alternative format: player1/player2 objects
    if (match.player1 && match.player2) {
      return [
        match.player1.name || match.player1.lastName || 'Player 1',
        match.player2.name || match.player2.lastName || 'Player 2'
      ];
    }
    
    return ['Player A', 'Player B'];
  }

  formatPlayerName(playerTeam) {
    if (!playerTeam) return 'Unknown';
    
    const firstName = playerTeam.PlayerFirstName || '';
    const lastName = playerTeam.PlayerLastName || '';
    
    // Handle doubles - if there's a partner, show both players
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
    return match.ResultString ||
           match.score || 
           match.currentScore || 
           match.liveScore || 
           '0-0';
  }

  extractTournamentName(match) {
    if (!match) return 'Unknown Tournament';
    
    // For ATP API, tournament info might be in parent data structure
    // For now, check common field names
    return match.TournamentName ||
           match.tournament || 
           match.tournamentName || 
           match.tournamentTitle ||
           'Unknown Tournament';
  }

  extractRound(match) {
    if (!match) return 'Unknown Round';
    
    // ATP API format: Round field
    return match.Round ||
           match.round || 
           match.roundName || 
           match.roundDescription ||
           'Unknown Round';
  }

  extractStatus(match) {
    if (!match) return 'Unknown';
    
    // ATP API format: Status field (P=in progress, F=finished, etc.)
    return match.Status ||
           match.status ||
           'Unknown';
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
    return match.CourtName ||
           match.court || 
           match.courtName || 
           match.venue ||
           'Unknown Court';
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
  }

  clearStates() {
    this.previousStates.clear();
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
