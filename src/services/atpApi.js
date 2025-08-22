const axios = require('axios');
const config = require('../config');

class AtpApiService {
  constructor() {
    this.client = axios.create({
      baseURL: config.atpApi.baseUrl,
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${config.atpApi.bearerToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ATP-Live-Proxy/1.0.0',
      },
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[ATPAPI] Making request to: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[ATPAPI] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        return response;
      },
      (error) => {
        if(error.response?.status != 404) {
          console.error('[ATPAPI] API Error:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            url: error.config?.url,
            message: error.message,
          });
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Make a GET request to the ATP API
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} API response
   */
  async get(endpoint, params = {}) {
    try {
      const response = await this.client.get(endpoint, { params });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ===== DRAWS ENDPOINTS =====
  /**
   * Get live draw that was saved to the DB, includes results if they have not yet been published
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Live draw data
   */
  async getLiveDraw(params = {}) {
    return this.get('/Draws/live', params);
  }

  /**
   * Get a draw that was saved to the DB
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Draw data
   */
  async getDraw(params = {}) {
    return this.get('/Draws', params);
  }

  // ===== H2H (HEAD-TO-HEAD) ENDPOINTS =====
  /**
   * Get player bios and H2H by match ID
   * @param {string} matchId - Match ID
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} H2H data
   */
  async getH2HByMatch(matchId, params = {}) {
    return this.get(`/H2H/${matchId}`, params);
  }

  /**
   * Get player details and H2H by player IDs
   * @param {string} playerId - Player ID
   * @param {string} opponentId - Opponent ID
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} H2H data
   */
  async getH2HByPlayers(playerId, opponentId, params = {}) {
    return this.get(`/H2H/${playerId}/${opponentId}`, params);
  }

  // ===== LIVE MATCHES ENDPOINTS =====
  /**
   * Get currently live matches and their scores
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Live matches data
   */
  async getLiveMatches(params = {}) {
    return this.get('/LiveMatches/tournament', params);
  }

  // ===== MATCH STATS ENDPOINTS =====
  /**
   * Get the Match Stats data for a specific match
   * @param {string} matchId - Match ID
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Match stats data
   */
  async getMatchStats(matchId, params = {}) {
    return this.get(`/MatchStats/${matchId}`, params);
  }

  // ===== PLAYER LIST ENDPOINTS =====
  /**
   * Get tournament player list
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Player list data
   */
  async getPlayerList(params = {}) {
    return this.get('/PlayerList', params);
  }

  // ===== RESULTS ENDPOINTS =====
  /**
   * Get completed match results for the tournament
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Match results data
   */
  async getResults(params = {}) {
    return this.get('/Results', params);
  }

  // ===== SCHEDULES ENDPOINTS =====
  /**
   * Get a schedule that was saved to the DB
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Schedule data
   */
  async getSchedule(params = {}) {
    return this.get('/Schedules', params);
  }

  // ===== TEAM CUP RANKINGS ENDPOINTS =====
  /**
   * Get the ATP Cup team rankings
   * @param {Object} params - Query parameters including rankDate
   * @returns {Promise<Object>} Team cup rankings data
   */
  async getTeamCupRankings(params = {}) {
    return this.get('/TeamCupRankings', params);
  }

  // ===== TOURNAMENTS ENDPOINTS =====
  /**
   * Get detailed information about a specific tournament
   * @param {string|number} tournamentYear - Event year of the tournament
   * @param {string|number} tournamentId - Event id of the tournament
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Tournament details data
   */
  async getTournament(tournamentYear, tournamentId, params = {}) {
    return this.get(`/Tournaments/${tournamentYear}/${tournamentId}`, params);
  }

  /**
   * Handle API errors and format them consistently
   * @param {Error} error - Axios error
   * @returns {Error} Formatted error
   */
  handleError(error) {
    if (error.response) {
      // Server responded with error status
      const { status, statusText, data } = error.response;

      // 404 means no results, not an error
      if(status == 404) return;
      const apiError = new Error(`ATP API Error: ${status} ${statusText}`);
      apiError.status = status;
      apiError.statusText = statusText;
      apiError.data = data;
      return apiError;
    } else if (error.request) {
      // Request was made but no response received
      const networkError = new Error('ATP API Network Error: No response received');
      networkError.status = 503;
      networkError.statusText = 'Service Unavailable';
      return networkError;
    } else {
      // Something else happened
      const genericError = new Error(`ATP API Error: ${error.message}`);
      genericError.status = 500;
      genericError.statusText = 'Internal Server Error';
      return genericError;
    }
  }
}

module.exports = new AtpApiService(); 
