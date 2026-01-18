import { fetch } from 'undici';
import { TokenProvider } from './TokenProvider.js';

export interface McpRequest {
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export class McpClient {
  constructor(
    private tokenProvider: TokenProvider,
    private apiUrl: string
  ) {}

  async call(request: McpRequest): Promise<McpResponse> {
    const token = await this.tokenProvider.getToken();
    
    const response = await fetch(`${this.apiUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return {
        error: {
          code: response.status,
          message: response.statusText,
        },
      };
    }

    return (await response.json()) as McpResponse;
  }

  async getProducts(params?: Record<string, unknown>): Promise<McpResponse> {
    return this.call({
      method: 'products.list',
      params,
    });
  }

  async getProduct(productId: string): Promise<McpResponse> {
    return this.call({
      method: 'products.get',
      params: { id: productId },
    });
  }

  async searchProducts(query: string): Promise<McpResponse> {
    return this.call({
      method: 'products.search',
      params: { query },
    });
  }
}
