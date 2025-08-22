const eventGenerator = require('../services/eventGenerator');
const eventOutput = require('../services/eventOutput');
const { EVENT_TYPES } = require('../types/events');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.EVENTS_ENABLED = 'true';
process.env.EVENTS_CONSOLE_OUTPUT = 'false'; // Disable console output for tests

describe('JSON Diff Event Generation System', () => {
  beforeEach(() => {
    // Clear any previous states before each test
    eventGenerator.clearStates();
    eventOutput.setEnabled(true);
  });

  describe('Event Generator Service (JSON Diff)', () => {
    describe('Live Match Events', () => {
      it('should generate match started event for new match', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - no matches (nested structure)
        const initialData = { 
          TournamentMatches: [{
            TournamentName: 'ATP Masters 1000',
            Matches: []
          }]
        };
        const events1 = eventGenerator.processData(endpoint, initialData);
        expect(events1).toHaveLength(0); // No events on first poll
        
        // Second poll - new match appears (nested structure)
        const newMatchData = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters 1000',
            Matches: [{
              MatchId: 'match_123',
              players: [
                { name: 'Novak Djokovic' },
                { name: 'Rafael Nadal' }
              ],
              score: '0-0',
              tournament: 'ATP Masters 1000',
              round: 'Quarterfinals',
              court: 'Centre Court'
            }]
          }]
        };
        
        const events2 = eventGenerator.processData(endpoint, newMatchData);
        
        expect(events2).toHaveLength(1);
        expect(events2[0].event_type).toBe(EVENT_TYPES.MATCH_STARTED);
        expect(events2[0].match_id).toBe('match_123');
        expect(events2[0].description).toContain('Novak Djokovic vs Rafael Nadal');
        expect(events2[0].data.players).toEqual(['Novak Djokovic', 'Rafael Nadal']);
        expect(events2[0].data.tournament).toBe('ATP Masters 1000');
      });

      it('should generate match finished event when match disappears', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - match in progress (nested structure)
        const matchInProgress = {
          TournamentMatches: [{
            TournamentName: 'Wimbledon',
            Matches: [{
              MatchId: 'match_456',
              players: [
                { name: 'Roger Federer' },
                { name: 'Andy Murray' }
              ],
              score: '6-4, 3-2',
              tournament: 'Wimbledon',
              round: 'Final'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, matchInProgress);
        
        // Second poll - match finished (removed from live matches)
        const noMatches = { 
          TournamentMatches: [{
            TournamentName: 'Wimbledon',
            Matches: []
          }]
        };
        
        const events = eventGenerator.processData(endpoint, noMatches);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.MATCH_FINISHED);
        expect(events[0].match_id).toBe('match_456');
        expect(events[0].description).toContain('Roger Federer vs Andy Murray');
        expect(events[0].data.finalScore).toBe('6-4, 3-2');
      });

      it('should generate score update event for score changes', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - initial score (nested structure)
        const initialMatch = {
          TournamentMatches: [{
            TournamentName: 'US Open',
            Matches: [{
              MatchId: 'match_789',
              players: [
                { name: 'Carlos Alcaraz' },
                { name: 'Jannik Sinner' }
              ],
              score: '6-4, 2-1',
              tournament: 'US Open',
              round: 'Semifinals'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, initialMatch);
        
        // Second poll - score updated (nested structure)
        const updatedMatch = {
          TournamentMatches: [{
            TournamentName: 'US Open',
            Matches: [{
              MatchId: 'match_789',
              players: [
                { name: 'Carlos Alcaraz' },
                { name: 'Jannik Sinner' }
              ],
              score: '6-4, 6-3',
              tournament: 'US Open',
              round: 'Semifinals'
            }]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, updatedMatch);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.SCORE_UPDATED);
        expect(events[0].match_id).toBe('match_789');
        expect(events[0].data.previousScore).toBe('6-4, 2-1');
        expect(events[0].data.currentScore).toBe('6-4, 6-3');
      });

      it('should detect set completion events', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - game in progress (nested structure)
        const beforeSet = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_set',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              score: '5-4'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, beforeSet);
        
        // Second poll - set completed (nested structure)
        const afterSet = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_set',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              score: '6-4'
            }]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, afterSet);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.SET_COMPLETED);
        expect(events[0].data.currentScore).toBe('6-4');
      });

      it('should detect tiebreak start events', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - regular score at 6-6 (nested structure)
        const beforeTiebreak = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_tb',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              score: '6-6'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, beforeTiebreak);
        
        // Second poll - tiebreak started (nested structure)
        const afterTiebreak = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_tb',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              score: '6-6 (1-0)'
            }]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, afterTiebreak);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.TIEBREAK_STARTED);
      });

      it('should detect court change events', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - on original court (nested structure)
        const originalCourt = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_court',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              court: 'Court 1'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, originalCourt);
        
        // Second poll - moved to new court (nested structure)
        const newCourt = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_court',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              court: 'Centre Court'
            }]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, newCourt);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.COURT_CHANGED);
        expect(events[0].data.previousCourt).toBe('Court 1');
        expect(events[0].data.currentCourt).toBe('Centre Court');
      });

      it('should detect status change events', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - match in progress (nested structure)
        const inProgress = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_status',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              status: 'in_progress'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, inProgress);
        
        // Second poll - match suspended (nested structure)
        const suspended = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_status',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              status: 'suspended'
            }]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, suspended);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.MATCH_SUSPENDED);
        expect(events[0].data.currentStatus).toBe('suspended');
      });

      it('should handle player retirement events', () => {
        const endpoint = '/api/live-matches';
        
        const beforeRetired = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_ret',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              status: 'in_progress'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, beforeRetired);
        
        const afterRetired = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_ret',
              players: [{ name: 'Player A' }, { name: 'Player B' }],
              status: 'retired'
            }]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, afterRetired);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.PLAYER_RETIRED);
        expect(events[0].priority).toBe('critical');
      });

      it('should handle multiple simultaneous changes', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - two matches (nested structure)
        const twoMatches = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [
              {
                MatchId: 'match_1',
                players: [{ name: 'Player A' }, { name: 'Player B' }],
                score: '6-4, 2-1',
                court: 'Court 1'
              },
              {
                MatchId: 'match_2', 
                players: [{ name: 'Player C' }, { name: 'Player D' }],
                score: '3-3'
              }
            ]
          }]
        };
        
        eventGenerator.processData(endpoint, twoMatches);
        
        // Second poll - multiple changes: match 1 score update + court change, match 2 finished, match 3 started (nested structure)
        const multipleChanges = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [
              {
                MatchId: 'match_1',
                players: [{ name: 'Player A' }, { name: 'Player B' }],
                score: '6-4, 6-2', // Score changed
                court: 'Centre Court' // Court changed
              },
              {
                MatchId: 'match_3', // New match
                players: [{ name: 'Player E' }, { name: 'Player F' }],
                score: '0-0'
              }
            ]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, multipleChanges);
        
        // Should generate multiple events
        expect(events.length).toBeGreaterThan(1);
        
        const eventTypes = events.map(e => e.event_type);
        expect(eventTypes).toContain(EVENT_TYPES.SCORE_UPDATED); // match_1 score
        expect(eventTypes).toContain(EVENT_TYPES.COURT_CHANGED); // match_1 court
        expect(eventTypes).toContain(EVENT_TYPES.MATCH_FINISHED); // match_2 finished
        expect(eventTypes).toContain(EVENT_TYPES.MATCH_STARTED); // match_3 started
      });
    });

    describe('Data Structure Handling', () => {
      it('should handle different data structures', () => {
        const endpoint = '/api/live-matches';
        
        // Test array format
        const arrayFormat = [{
          matchId: 'test_123',
          players: [{ name: 'Player 1' }, { name: 'Player 2' }],
          score: '0-0'
        }];
        
        const events1 = eventGenerator.processData(endpoint, arrayFormat);
        expect(events1).toHaveLength(0); // First poll
        
        // Test object format with matches property
        const objectFormat = {
          matches: [{
            matchId: 'test_456',
            players: [{ name: 'Player 3' }, { name: 'Player 4' }],
            score: '1-0'
          }]
        };
        
        const events2 = eventGenerator.processData(endpoint, objectFormat);
        expect(events2).toHaveLength(2); // Array match finished, object match started
      });

      it('should handle missing or malformed data gracefully', () => {
        const endpoint = '/api/live-matches';
        
        // Test null data
        const events1 = eventGenerator.processData(endpoint, null);
        expect(events1).toHaveLength(0);
        
        // Test empty object
        const events2 = eventGenerator.processData(endpoint, {});
        expect(events2).toHaveLength(0);
        
        // Test malformed match data - should not crash
        const malformedData = {
          TournamentMatches: [{
            // Missing required fields
            someField: 'value'
          }]
        };
        
        expect(() => {
          eventGenerator.processData(endpoint, malformedData);
        }).not.toThrow();
      });

      it('should handle different match ID field names', () => {
        const endpoint = '/api/live-matches';
        
        const dataWithDifferentIds = {
          TournamentMatches: [
            { matchId: 'test_1', players: [{ name: 'A' }, { name: 'B' }] },
            { MatchId: 'test_2', players: [{ name: 'C' }, { name: 'D' }] },
            { id: 'test_3', players: [{ name: 'E' }, { name: 'F' }] },
            { match_id: 'test_4', players: [{ name: 'G' }, { name: 'H' }] }
          ]
        };
        
        eventGenerator.processData(endpoint, dataWithDifferentIds);
        
        // Remove all matches
        const events = eventGenerator.processData(endpoint, { TournamentMatches: [] });
        
        expect(events).toHaveLength(4); // Should handle all different ID formats
        events.forEach(event => {
          expect(event.event_type).toBe(EVENT_TYPES.MATCH_FINISHED);
          expect(event.match_id).toMatch(/test_[1-4]/);
        });
      });
    });

    describe('Configuration', () => {
      it('should respect enabled/disabled configuration', () => {
        const endpoint = '/api/live-matches';
        
        // Disable event generation
        eventGenerator.setEnabled(false);
        
        const matchData = {
          TournamentMatches: [{
            matchId: 'test_disabled',
            players: [{ name: 'Player A' }, { name: 'Player B' }]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, matchData);
        expect(events).toHaveLength(0);
        
        // Re-enable
        eventGenerator.setEnabled(true);
      });

      it('should provide accurate service statistics', () => {
        const endpoint = '/api/live-matches';
        const stats1 = eventGenerator.getStats();
        
        expect(stats1.enabled).toBe(true);
        expect(stats1.implementation).toBe('json-diff-ts');
        expect(stats1.totalStates).toBe(0);
        
        // Process some data
        eventGenerator.processData(endpoint, { TournamentMatches: [] });
        
        const stats2 = eventGenerator.getStats();
        expect(stats2.totalStates).toBe(1);
        expect(stats2.trackedEndpoints).toContain(endpoint);
      });
    });
  });

  describe('Advanced Event Detection', () => {
    describe('Score Pattern Recognition', () => {
      it('should correctly identify set completions', () => {
        const service = eventGenerator;
        
        // Test various set completion patterns
        expect(service.isSetCompletion('5-4', '6-4')).toBe(true);
        expect(service.isSetCompletion('5-6', '6-7')).toBe(true);
        expect(service.isSetCompletion('6-6', '7-6')).toBe(true);
        expect(service.isSetCompletion('4-5', '5-5')).toBe(false);
        expect(service.isSetCompletion('6-4', '6-4')).toBe(false);
      });

      it('should correctly identify game wins', () => {
        const service = eventGenerator;
        
        // Test game win patterns
        expect(service.isGameWin('40-30', '0-0')).toBe(true);
        expect(service.isGameWin('30-40', '15-0')).toBe(true);
        expect(service.isGameWin('30-30', '40-30')).toBe(false);
        expect(service.isGameWin('15-0', '30-0')).toBe(false);
      });

      it('should correctly identify tiebreak starts', () => {
        const service = eventGenerator;
        
        // Test tiebreak detection
        expect(service.isTiebreakStart('6-6', '6-6 (1-0)')).toBe(true);
        expect(service.isTiebreakStart('6-6', '6-6 (0-1)')).toBe(true);
        expect(service.isTiebreakStart('5-6', '6-6')).toBe(false);
        expect(service.isTiebreakStart('6-6 (1-0)', '6-6 (2-0)')).toBe(false);
      });
    });
  });

  describe('Event Output Service', () => {
    it('should validate events before output', () => {
      const validEvent = {
        event_type: EVENT_TYPES.MATCH_STARTED,
        timestamp: new Date().toISOString(),
        match_id: 'test_123',
        description: 'Test event',
        data: {}
      };
      
      const invalidEvent = {
        event_type: 'invalid_type',
        // Missing required fields
      };
      
      const originalConsoleLog = console.log;
      const originalConsoleWarn = console.warn;
      const logCalls = [];
      const warnCalls = [];
      console.log = (...args) => logCalls.push(args);
      console.warn = (...args) => warnCalls.push(args);
      
      eventOutput.output([validEvent, invalidEvent]);
      
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
      
      expect(warnCalls.length).toBeGreaterThan(0); // Warning for invalid event
      expect(logCalls.length).toBeGreaterThan(0); // Output for valid event
    });
  });
});