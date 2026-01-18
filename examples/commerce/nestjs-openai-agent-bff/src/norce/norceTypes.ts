/**
 * OAuth token response from Norce Identity server.
 */
export interface NorceTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * Configuration options for NorceTokenProvider.
 */
export interface NorceTokenProviderOptions {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope: string;
}

/**
 * Cached token with expiry information.
 */
export interface CachedToken {
  accessToken: string;
  expiresAt: number;
}
