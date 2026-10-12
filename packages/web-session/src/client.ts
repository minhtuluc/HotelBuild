'use client';
import { SessionCoordinator } from './coordinator.js';
import { ApiError } from '@pinehill/api-client';
import { errorBodySchema } from '@pinehill/contracts';
import { isPublicSession, type PublicSession, type SessionState } from './protocol.js';
export interface SessionClientOptions {
  kind: 'staff' | 'guest';
  coordinator?: SessionCoordinator;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onExpired?: () => void;
  /** In-memory notification for feature compositions to clear and revalidate private caches. */
  onSessionChanged?: (accessToken: string | null) => void;
}
export function createSessionClient(options: SessionClientOptions) {
  let coordinator = options.coordinator;
  let unsubscribe: (() => void) | undefined;
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let inFlight: Promise<string | null> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    disposed = false,
    expired = false;
  const notifyExpired = () => {
    if (expired) return;
    expired = true;
    options.onExpired ? options.onExpired() : window.dispatchEvent(new Event('session-expired'));
  };
  const margin = (state: SessionState) => Math.min(30000, state.expiresInSeconds * 100);
  const valid = (state: SessionState | undefined): state is SessionState =>
    !!state && state.expiresAt - now() > margin(state);
  const changed = (state: SessionState | undefined) => {
    clearTimeout(timer);
    options.onSessionChanged?.(state?.accessToken ?? null);
    if (!state) {
      notifyExpired();
      return;
    }
    expired = false;
    timer = setTimeout(
      () => {
        void refresh();
      },
      Math.min(2147483647, Math.max(1, state.expiresAt - now() - margin(state))),
    );
  };
  function getCoordinator(): SessionCoordinator {
    if (disposed) throw new Error('Session client is disposed');
    // Client components also render on the server. Browser resources belong to operations.
    coordinator ??= new SessionCoordinator({ name: `pinehill-session-${options.kind}` });
    unsubscribe ??= coordinator.subscribe(changed);
    return coordinator;
  }
  async function post(action: string, body?: unknown, token?: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const headers: Record<string, string> = {
        'x-session-request': '1',
        'content-type': 'application/json',
      };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetchImpl(`/api/session/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data: unknown = response.status === 204 ? undefined : await response.json();
      if (!response.ok) {
        const parsed = errorBodySchema.safeParse(data);
        throw new ApiError({
          kind: 'http',
          status: response.status,
          code: parsed.success ? parsed.data.code : undefined,
          message: 'Không thể hoàn tất yêu cầu phiên.',
        });
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function issue(action: 'login' | 'refresh', input?: unknown): Promise<PublicSession> {
    const data = await post(action, input);
    if (!isPublicSession(data))
      throw new ApiError({ kind: 'protocol', message: 'Phản hồi phiên không hợp lệ.' });
    const session = {
      accessToken: data.accessToken,
      expiresInSeconds: data.expiresInSeconds,
      mustChangePassword: data.mustChangePassword,
    };
    getCoordinator().publish({ ...session, expiresAt: now() + session.expiresInSeconds * 1000 });
    return session;
  }
  async function refresh(rejectedToken?: string): Promise<string | null> {
    if (disposed) return null;
    const coordinator = getCoordinator();
    inFlight ??= coordinator
      .run(async () => {
        try {
          const state = await coordinator.readShared();
          if (expired) return null;
          if (valid(state) && (rejectedToken === undefined || state.accessToken !== rejectedToken))
            return state.accessToken;
          return (await issue('refresh')).accessToken;
        } catch {
          coordinator.publish(undefined);
          return null;
        }
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }
  return {
    login: async (input: unknown) => getCoordinator().run(() => issue('login', input)),
    refresh,
    getAccessToken: async (): Promise<string | null> => {
      if (disposed || expired) return null;
      const state = getCoordinator().current();
      return valid(state) ? state.accessToken : refresh();
    },
    onUnauthorized: async (rejectedToken?: string): Promise<boolean> => {
      if (disposed) return false;
      const used = rejectedToken ?? getCoordinator().current()?.accessToken;
      return (await refresh(used)) !== null;
    },
    logout: async () => {
      const coordinator = getCoordinator();
      return coordinator.run(async () => {
        try {
          const state = await coordinator.readShared();
          await post('logout', undefined, state?.accessToken);
        } finally {
          coordinator.publish(undefined);
        }
      });
    },
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe?.();
      coordinator?.dispose();
    },
  };
}

export { createJourneyApiClient, type JourneySession } from './journey-client.js';
