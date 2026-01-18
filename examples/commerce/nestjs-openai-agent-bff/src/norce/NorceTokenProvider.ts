import { fetch } from 'undici';
import type {
  NorceTokenResponse,
  NorceTokenProviderOptions,
  CachedToken,
} from './norceTypes.js';
import { withTimeout } from '../http/timeout.js';
import { config } from '../config.js';

/**
 * Token refresh buffer in milliseconds.
 * Token will be refreshed when less than this time remains before expiry.
 */
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000; // 60 seconds

/**
 * NorceTokenProvider handles OAuth2 client credentials flow for Norce API authentication.
 *
 * Features:
 * - Token caching per applicationId with automatic refresh when near expiry (<60s remaining)
 * - Concurrency-safe: multiple simultaneous callers for the same applicationId share a single HTTP request
 * - Proper error handling for non-200 responses
 */
export class NorceTokenProvider {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenUrl: string;
  private readonly scope: string;

  private cachedTokens: Map<string, CachedToken> = new Map();
  private inFlightRefreshes: Map<string, Promise<string>> = new Map();

  constructor(options: NorceTokenProviderOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.tokenUrl = options.tokenUrl;
    this.scope = options.scope;
  }

  /**
   * Get a valid access token for the specified applicationId.
   *
   * If a valid cached token exists for this applicationId and has more than 60 seconds until expiry,
   * returns the cached token. Otherwise, fetches a new token.
   *
   * This method is concurrency-safe: if multiple callers request a token for the same applicationId
   * simultaneously while a refresh is in progress, they will all await
   * the same HTTP request rather than making duplicate requests.
   *
   * @param applicationId - The application ID for which to get a token
   * @returns Promise resolving to a valid access token string
   * @throws Error if token fetch fails or returns non-200 response
   */
  async getAccessToken(applicationId: string): Promise<string> {
    // Check if we have a valid cached token for this applicationId with sufficient time remaining
    if (this.isTokenValid(applicationId)) {
      return this.cachedTokens.get(applicationId)!.accessToken;
    }

    // If a refresh is already in progress for this applicationId, wait for it
    const existingRefresh = this.inFlightRefreshes.get(applicationId);
    if (existingRefresh) {
      return existingRefresh;
    }

    // Start a new refresh for this applicationId and store the promise
    const refreshPromise = this.refreshToken(applicationId);
    this.inFlightRefreshes.set(applicationId, refreshPromise);

    try {
      const token = await refreshPromise;
      return token;
    } finally {
      // Clear the in-flight promise for this applicationId once complete (success or failure)
      this.inFlightRefreshes.delete(applicationId);
    }
  }

  /**
   * Check if the cached token for the given applicationId is valid and has sufficient time remaining.
   * A token is considered valid if it exists and has more than 60 seconds until expiry.
   */
  private isTokenValid(applicationId: string): boolean {
    const cachedToken = this.cachedTokens.get(applicationId);
    if (!cachedToken) {
      return false;
    }

    const now = Date.now();
    const timeRemaining = cachedToken.expiresAt - now;

    return timeRemaining > TOKEN_REFRESH_BUFFER_MS;
  }

  /**
   * Fetch a new token from the OAuth server for the specified applicationId.
   *
   * @param applicationId - The application ID for which to fetch a token
   * @returns Promise resolving to the new access token string
   * @throws Error if the request fails or returns non-200 response
   * @throws AppError with category TIMEOUT if the request times out
   */
  private async refreshToken(applicationId: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
    });

    const response = await withTimeout(
      (signal) => fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal,
      }),
      config.timeouts.oauthMs,
      'OAuth token fetch'
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unable to read error body');
      throw new Error(
        `Failed to fetch OAuth token: ${response.status} ${response.statusText}. ${errorBody}`
      );
    }

    let data: NorceTokenResponse;
    try {
      data = (await response.json()) as NorceTokenResponse;
    } catch {
      throw new Error('Failed to parse OAuth token response as JSON');
    }

    if (!data.access_token || typeof data.expires_in !== 'number') {
      throw new Error('Invalid OAuth token response: missing access_token or expires_in');
    }

    // Cache the token for this applicationId with expiry timestamp
    this.cachedTokens.set(applicationId, {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    return data.access_token;
  }

  /**
   * Clear all cached tokens. Useful for testing or forcing a refresh.
   */
  clearCache(): void {
    this.cachedTokens.clear();
    this.inFlightRefreshes.clear();
  }
}
