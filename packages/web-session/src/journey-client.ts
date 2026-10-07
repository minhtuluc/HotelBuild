import { ApiClient } from '@pinehill/api-client';
export interface JourneySession {
  getAccessToken: () => string | null | Promise<string | null>;
  onUnauthorized: (rejectedAccessToken?: string) => Promise<boolean>;
}
export function createJourneyApiClient(options: {
  baseUrl: string;
  session: JourneySession;
}): ApiClient {
  const url = new URL(options.baseUrl);
  if (url.origin !== options.baseUrl || !['http:', 'https:'].includes(url.protocol))
    throw new Error('Journey requires the exact app origin');
  if (typeof globalThis.location !== 'undefined' && globalThis.location.origin !== url.origin)
    throw new Error('Journey must use the current app origin');
  return new ApiClient({
    baseUrl: `${url.origin}/api/session/journey`,
    getAccessToken: options.session.getAccessToken,
    onUnauthorized: options.session.onUnauthorized,
    fetchImpl: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('x-session-request', '1');
      return fetch(input, { ...init, headers });
    },
  });
}
