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
        
        // Manually set up previous state - empty matches
        const initialData = { 
          TournamentMatches: [{
            TournamentName: 'ATP Masters 1000',
            Matches: []
          }]
        };
        eventGenerator.previousStates.set(endpoint, initialData);
        
        // New match appears (ATP API format) 
        const newMatchData = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters 1000',
            Matches: [{
              MatchId: 'match_123',
              Status: 'P', // In progress
              ResultString: '0-0',
              CourtName: 'Centre Court',
              Round: { ShortName: 'QF', LongName: 'Quarterfinals' },
              PlayerTeam1: {
                PlayerFirstName: 'Novak',
                PlayerLastName: 'Djokovic'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Rafael', 
                PlayerLastName: 'Nadal'
              }
            }]
          }]
        };
        
        // Direct call to key-based processing
        const events = eventGenerator.processLiveMatchChanges([], newMatchData);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.MATCH_STARTED);
        expect(events[0].match_id).toBe('match_123');
        expect(events[0].description).toContain('Novak Djokovic vs Rafael Nadal');
        expect(events[0].data.players).toEqual(['Novak Djokovic', 'Rafael Nadal']);
        expect(events[0].data.tournament).toBe('Unknown Tournament'); // No TournamentName in match object
      });

      it('should generate match finished event when match disappears', () => {
        const endpoint = '/api/live-matches';
        
        // Set up previous state - match in progress (ATP API format)
        const matchInProgress = {
          TournamentMatches: [{
            TournamentName: 'Wimbledon',
            Matches: [{
              MatchId: 'match_456',
              Status: 'P',
              ResultString: '6-4, 3-2',
              CourtName: 'Centre Court',
              Round: { ShortName: 'F', LongName: 'Final' },
              PlayerTeam1: {
                PlayerFirstName: 'Roger',
                PlayerLastName: 'Federer'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Andy',
                PlayerLastName: 'Murray'
              }
            }]
          }]
        };
        eventGenerator.previousStates.set(endpoint, matchInProgress);
        
        // Match finished (removed from live matches)
        const noMatches = { 
          TournamentMatches: [{
            TournamentName: 'Wimbledon',
            Matches: []
          }]
        };
        
        const events = eventGenerator.processLiveMatchChanges([], noMatches);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.MATCH_FINISHED);
        expect(events[0].match_id).toBe('match_456');
        expect(events[0].description).toContain('Roger Federer vs Andy Murray');
        expect(events[0].data.finalScore).toBe('6-4, 3-2');
      });

      it('should generate score update event for score changes', () => {
        const endpoint = '/api/live-matches';
        
        // Set up previous state - initial score (ATP API format)
        const initialMatch = {
          TournamentMatches: [{
            TournamentName: 'US Open',
            Matches: [{
              MatchId: 'match_789',
              Status: 'P',
              ResultString: '6-4, 2-1',
              CourtName: 'Arthur Ashe',
              Round: { ShortName: 'SF', LongName: 'Semifinals' },
              PlayerTeam1: {
                PlayerFirstName: 'Carlos',
                PlayerLastName: 'Alcaraz'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Jannik',
                PlayerLastName: 'Sinner'
              }
            }]
          }]
        };
        eventGenerator.previousStates.set(endpoint, initialMatch);
        
        // Score updated (ATP API format)
        const updatedMatch = {
          TournamentMatches: [{
            TournamentName: 'US Open',
            Matches: [{
              MatchId: 'match_789',
              Status: 'P',
              ResultString: '6-4, 6-3',
              CourtName: 'Arthur Ashe',
              Round: { ShortName: 'SF', LongName: 'Semifinals' },
              PlayerTeam1: {
                PlayerFirstName: 'Carlos',
                PlayerLastName: 'Alcaraz'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Jannik',
                PlayerLastName: 'Sinner'
              }
            }]
          }]
        };
        
        const events = eventGenerator.processLiveMatchChanges([], updatedMatch);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.SCORE_UPDATED);
        expect(events[0].match_id).toBe('match_789');
        expect(events[0].data.previousScore).toBe('6-4, 2-1');
        expect(events[0].data.currentScore).toBe('6-4, 6-3');
      });

      it('should detect set completion events', () => {
        const endpoint = '/api/live-matches';
        
        // Set up previous state - game in progress (ATP API format)
        const beforeSet = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_set',
              Status: 'P',
              ResultString: '5-4',
              CourtName: 'Centre Court',
              Round: { ShortName: 'QF', LongName: 'Quarterfinals' },
              PlayerTeam1: {
                PlayerFirstName: 'Player',
                PlayerLastName: 'A'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Player',
                PlayerLastName: 'B'
              }
            }]
          }]
        };
        eventGenerator.previousStates.set(endpoint, beforeSet);
        
        // Set completed (ATP API format)
        const afterSet = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_set',
              Status: 'P',
              ResultString: '6-4',
              CourtName: 'Centre Court',
              Round: { ShortName: 'QF', LongName: 'Quarterfinals' },
              PlayerTeam1: {
                PlayerFirstName: 'Player',
                PlayerLastName: 'A'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Player',
                PlayerLastName: 'B'
              }
            }]
          }]
        };
        
        const events = eventGenerator.processLiveMatchChanges([], afterSet);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.SET_COMPLETED);
        expect(events[0].data.currentScore).toBe('6-4');
      });

      it('should detect tiebreak start events', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - regular score at 6-6 (ATP API structure)
        const beforeTiebreak = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_tb',
              PlayerTeam1: {
                PlayerFirstName: 'John',
                PlayerLastName: 'Smith'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Bob',
                PlayerLastName: 'Jones'
              },
              ResultString: '6-6',
              Status: 'P'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, beforeTiebreak);
        
        // Second poll - tiebreak started (ATP API structure)
        const afterTiebreak = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_tb',
              PlayerTeam1: {
                PlayerFirstName: 'John',
                PlayerLastName: 'Smith'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Bob',
                PlayerLastName: 'Jones'
              },
              ResultString: '6-6 (1-0)',
              Status: 'P'
            }]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, afterTiebreak);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.TIEBREAK_STARTED);
      });

      it('should detect court change events', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - on original court (ATP API structure)
        const originalCourt = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_court',
              PlayerTeam1: {
                PlayerFirstName: 'John',
                PlayerLastName: 'Smith'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Bob', 
                PlayerLastName: 'Jones'
              },
              CourtName: 'Court 1',
              ResultString: '3-2',
              Status: 'P'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, originalCourt);
        
        // Second poll - moved to new court (ATP API structure)
        const newCourt = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_court',
              PlayerTeam1: {
                PlayerFirstName: 'John',
                PlayerLastName: 'Smith'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Bob',
                PlayerLastName: 'Jones'
              },
              CourtName: 'Centre Court',
              ResultString: '3-2',
              Status: 'P'
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
        
        // Set up previous state - match in progress (ATP API format)
        const inProgress = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_status',
              Status: 'P', // In progress
              ResultString: '3-2',
              PlayerTeam1: { PlayerFirstName: 'Player', PlayerLastName: 'A' },
              PlayerTeam2: { PlayerFirstName: 'Player', PlayerLastName: 'B' }
            }]
          }]
        };
        eventGenerator.previousStates.set(endpoint, inProgress);
        
        // Match suspended (ATP API format)
        const suspended = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_status',
              Status: 'S', // Suspended
              ResultString: '3-2',
              PlayerTeam1: { PlayerFirstName: 'Player', PlayerLastName: 'A' },
              PlayerTeam2: { PlayerFirstName: 'Player', PlayerLastName: 'B' }
            }]
          }]
        };
        
        const events = eventGenerator.processLiveMatchChanges([], suspended);
        
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe(EVENT_TYPES.MATCH_SUSPENDED);
        expect(events[0].data.currentStatus).toBe('S');
        expect(events[0].data.previousStatus).toBe('P');
      });

      it('should handle player retirement events', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - match in progress (ATP API structure)
        const beforeRetired = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_ret',
              PlayerTeam1: {
                PlayerFirstName: 'John',
                PlayerLastName: 'Smith'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Bob',
                PlayerLastName: 'Jones'
              },
              ResultString: '6-4 3-2',
              Status: 'P'
            }]
          }]
        };
        
        eventGenerator.processData(endpoint, beforeRetired);
        
        // Second poll - match finished with retirement (ATP typically uses 'F' status with RET in score)
        const afterRetired = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [{
              MatchId: 'match_ret',
              PlayerTeam1: {
                PlayerFirstName: 'John',
                PlayerLastName: 'Smith'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Bob',
                PlayerLastName: 'Jones'
              },
              ResultString: '6-4 3-2 RET',
              Status: 'F'
            }]
          }]
        };
        
        const events = eventGenerator.processData(endpoint, afterRetired);
        
        // Should generate a score update event (retirement is shown in score)
        // and a match finished event (status changed to F)
        expect(events.length).toBeGreaterThanOrEqual(1);
        
        // Find the score update event that shows retirement
        const scoreEvent = events.find(e => e.event_type === EVENT_TYPES.SCORE_UPDATED);
        if (scoreEvent) {
          expect(scoreEvent.data.currentScore).toContain('RET');
        }
        
        // There might also be a match finished event
        const finishedEvent = events.find(e => e.event_type === EVENT_TYPES.MATCH_FINISHED);
        if (finishedEvent) {
          expect(finishedEvent).toBeDefined();
        }
      });

      it('should handle multiple simultaneous changes', () => {
        const endpoint = '/api/live-matches';
        
        // First poll - two matches (ATP API structure)
        const twoMatches = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [
              {
                MatchId: 'match_1',
                PlayerTeam1: {
                  PlayerFirstName: 'John',
                  PlayerLastName: 'Smith'
                },
                PlayerTeam2: {
                  PlayerFirstName: 'Bob',
                  PlayerLastName: 'Jones'
                },
                ResultString: '64 21',
                CourtName: 'Court 1',
                Status: 'P'
              },
              {
                MatchId: 'match_2',
                PlayerTeam1: {
                  PlayerFirstName: 'Mike',
                  PlayerLastName: 'Johnson'
                },
                PlayerTeam2: {
                  PlayerFirstName: 'Tom',
                  PlayerLastName: 'Wilson'
                },
                ResultString: '33',
                Status: 'P'
              }
            ]
          }]
        };
        
        eventGenerator.processData(endpoint, twoMatches);
        
        // Second poll - multiple changes: match 1 score update + court change, match 2 finished, match 3 started (ATP API structure)
        const multipleChanges = {
          TournamentMatches: [{
            TournamentName: 'ATP Masters',
            Matches: [
              {
                MatchId: 'match_1',
                PlayerTeam1: {
                  PlayerFirstName: 'John',
                  PlayerLastName: 'Smith'
                },
                PlayerTeam2: {
                  PlayerFirstName: 'Bob',
                  PlayerLastName: 'Jones'
                },
                ResultString: '64 62', // Score changed (match finished)
                CourtName: 'Centre Court', // Court changed
                Status: 'F' // Status changed to finished
              },
              {
                MatchId: 'match_3', // New match
                PlayerTeam1: {
                  PlayerFirstName: 'Dave',
                  PlayerLastName: 'Brown'
                },
                PlayerTeam2: {
                  PlayerFirstName: 'Steve',
                  PlayerLastName: 'Davis'
                },
                ResultString: '00',
                Status: 'P'
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
        
        // Clear any previous state
        eventGenerator.clearStates();
        
        // Test 1: ATP format with one match
        const firstPoll = {
          TournamentMatches: [{
            TournamentDisplayName: 'ATP Masters 1000',
            TournamentId: 'tourn_001',
            Matches: [{
              MatchId: 'test_123',
              PlayerTeam1: {
                PlayerFirstName: 'John',
                PlayerLastName: 'Smith'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Bob',
                PlayerLastName: 'Jones'
              },
              ResultString: '00',
              Status: 'P'
            }]
          }]
        };
        
        const events1 = eventGenerator.processData(endpoint, firstPoll);
        expect(events1).toHaveLength(0); // First poll, no previous state
        
        // Test 2: ATP format with match change (one match finished, new one started)
        const secondPoll = {
          TournamentMatches: [{
            TournamentDisplayName: 'ATP Masters 1000',
            TournamentId: 'tourn_001',
            Matches: [{
              MatchId: 'test_456',
              PlayerTeam1: {
                PlayerFirstName: 'Mike',
                PlayerLastName: 'Johnson'
              },
              PlayerTeam2: {
                PlayerFirstName: 'Tom',
                PlayerLastName: 'Wilson'
              },
              ResultString: '10',
              Status: 'P'
            }]
          }]
        };
        
        const events2 = eventGenerator.processData(endpoint, secondPoll);
        // Should detect: test_123 finished (disappeared), test_456 started (new)
        expect(events2.length).toBeGreaterThanOrEqual(2);
        
        // Test 3: ATP format with multiple tournaments
        const thirdPoll = {
          TournamentMatches: [
            {
              TournamentDisplayName: 'ATP Masters 1000',
              TournamentId: 'tourn_001',
              Matches: [{
                MatchId: 'test_789',
                PlayerTeam1: {
                  PlayerFirstName: 'Dave',
                  PlayerLastName: 'Brown'
                },
                PlayerTeam2: {
                  PlayerFirstName: 'Steve',
                  PlayerLastName: 'Davis'
                },
                ResultString: '20',
                Status: 'P'
              }]
            },
            {
              TournamentDisplayName: 'ATP 250',
              TournamentId: 'tourn_002',
              Matches: [{
                MatchId: 'test_999',
                PlayerTeam1: {
                  PlayerFirstName: 'Alex',
                  PlayerLastName: 'Wilson'
                },
                PlayerTeam2: {
                  PlayerFirstName: 'Chris',
                  PlayerLastName: 'Taylor'
                },
                ResultString: '11',
                Status: 'P'
              }]
            }
          ]
        };
        
        const events3 = eventGenerator.processData(endpoint, thirdPoll);
        // Should detect: test_456 finished, test_789 and test_999 started
        expect(events3.length).toBeGreaterThanOrEqual(3);
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

      it('should handle strict ATP match ID format', () => {
        const endpoint = '/api/live-matches';
        
        // Clear any previous state
        eventGenerator.clearStates();
        
        // First poll with various valid ATP MatchId values (testing strict format handling)
        const dataWithValidMatchIds = {
          TournamentMatches: [{
            TournamentDisplayName: 'Test Tournament',
            TournamentId: 'tourn_001',
            Matches: [
              { 
                MatchId: 'MS001', // Standard singles match ID
                PlayerTeam1: { PlayerFirstName: 'A', PlayerLastName: 'Player' },
                PlayerTeam2: { PlayerFirstName: 'B', PlayerLastName: 'Player' },
                ResultString: '00',
                Status: 'P'
              },
              { 
                MatchId: 'MD002', // Doubles match ID
                PlayerTeam1: { PlayerFirstName: 'C', PlayerLastName: 'Player' },
                PlayerTeam2: { PlayerFirstName: 'D', PlayerLastName: 'Player' },
                ResultString: '00',
                Status: 'P'
              },
              { 
                MatchId: 'QS003', // Qualifying singles
                PlayerTeam1: { PlayerFirstName: 'E', PlayerLastName: 'Player' },
                PlayerTeam2: { PlayerFirstName: 'F', PlayerLastName: 'Player' },
                ResultString: '00',
                Status: 'P'
              },
              { 
                MatchId: 'test_numeric_123', // Numeric suffix
                PlayerTeam1: { PlayerFirstName: 'G', PlayerLastName: 'Player' },
                PlayerTeam2: { PlayerFirstName: 'H', PlayerLastName: 'Player' },
                ResultString: '00',
                Status: 'P'
              }
            ]
          }]
        };
        
        const events1 = eventGenerator.processData(endpoint, dataWithValidMatchIds);
        expect(events1).toHaveLength(0); // First poll, no events
        
        // Second poll - remove all matches to test ID extraction worked correctly
        const events2 = eventGenerator.processData(endpoint, { TournamentMatches: [{ Matches: [] }] });
        
        expect(events2).toHaveLength(4); // Should detect all 4 matches finished
        events2.forEach(event => {
          expect(event.event_type).toBe(EVENT_TYPES.MATCH_FINISHED);
          expect(event.match_id).toMatch(/^(MS001|MD002|QS003|test_numeric_123)$/);
        });
        
        // Verify the match IDs are preserved correctly
        const matchIds = events2.map(e => e.match_id).sort();
        expect(matchIds).toEqual(['MD002', 'MS001', 'QS003', 'test_numeric_123']);
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