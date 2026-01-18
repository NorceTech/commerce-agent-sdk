let cachedToken: string | null = null;

export async function fetchDemoToken(
  endpoint: string,
  applicationId: string,
  demoKey?: string
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (demoKey) {
    headers['X-Demo-Key'] = demoKey;
  }

  const response = await fetch(`${endpoint}/v1/auth/simple/token`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ applicationId }),
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status}`);
  }

  const data = (await response.json()) as { token: string };
  cachedToken = data.token;
  return cachedToken;
}

export function clearCachedToken(): void {
  cachedToken = null;
}

export function createTokenGetter(
  endpoint: string,
  applicationId: string,
  demoKey?: string
): () => Promise<string> {
  return async () => {
    if (cachedToken) {
      return cachedToken;
    }
    return fetchDemoToken(endpoint, applicationId, demoKey);
  };
}
