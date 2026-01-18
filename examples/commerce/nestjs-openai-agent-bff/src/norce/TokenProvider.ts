import { config } from '../config.js';
import { fetch } from 'undici';

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export class TokenProvider {
  private token: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private apiUrl: string = config.norce.mcp.baseUrl
  ) {}

  async getToken(): Promise<string> {
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.token;
    }

    await this.refreshToken();
    
    if (!this.token) {
      throw new Error('Failed to obtain access token');
    }
    
    return this.token;
  }

  private async refreshToken(): Promise<void> {
    const tokenUrl = `${this.apiUrl}/oauth/token`;
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get token: ${response.statusText}`);
    }

    const data = (await response.json()) as TokenResponse;
    this.token = data.access_token;
    this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  }

  isTokenValid(): boolean {
    return this.token !== null && this.tokenExpiry !== null && this.tokenExpiry > new Date();
  }
}
