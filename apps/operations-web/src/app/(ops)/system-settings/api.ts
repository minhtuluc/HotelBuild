import { ApiClient, ApiError } from '@pinehill/api-client';
import {
  userMeSchema,
  systemSettingQuerySchema,
  systemSettingSchema,
  listResponseSchema,
  systemSettingUpdateRequestSchema,
  type SystemSetting,
} from '@pinehill/contracts';
import { createSessionClient } from '@pinehill/web-session/client';
import { SettingsController, type SettingsPorts } from './controller.js';
export function settingsPorts(client: ApiClient): SettingsPorts {
  return {
    actor: async (signal) =>
      (
        await client.request({
          method: 'GET',
          path: '/auth/me',
          decoder: userMeSchema,
          signal,
          maxAttempts: 1,
        })
      ).data,
    list: async (signal) => {
      const rows: SystemSetting[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (;;) {
        const page = (
          await client.request({
            method: 'GET',
            path: '/system-settings',
            query: systemSettingQuerySchema.parse({ limit: 100, ...(cursor ? { cursor } : {}) }),
            decoder: listResponseSchema(systemSettingSchema),
            signal,
            maxAttempts: 1,
          })
        ).data;
        rows.push(...page.data);
        if (!page.meta.hasMore) return rows;
        const next = page.meta.nextCursor;
        if (!next || seen.has(next) || !page.data.length)
          throw new ApiError({ kind: 'protocol', message: 'Incomplete settings page' });
        seen.add(next);
        cursor = next;
      }
    },
    write: async (key, body, ifMatch, idempotencyKey, signal) => {
      await client.requestVoid({
        method: 'PUT',
        headers: { 'x-session-request': '1' },
        path: '/system-settings/' + encodeURIComponent(key),
        body: systemSettingUpdateRequestSchema.parse(body),
        ifMatch,
        idempotencyKey,
        signal,
        maxAttempts: 1,
      });
    },
  };
}
/** Pin the bearer verified by auth/me; mutation never retries with another identity. */
export function createSettingsWorkspace() {
  let active = true,
    verifiedToken: string | undefined,
    pinned: ApiClient | undefined;
  const session = createSessionClient({
    kind: 'staff',
    onExpired: () => controller.deny('expired'),
    onSessionChanged: (token) => {
      if (verifiedToken && token !== verifiedToken) {
        verifiedToken = undefined;
        pinned = undefined;
        void controller.sessionChanged();
      }
    },
  });
  const actor = async (signal: AbortSignal) => {
    const token = await session.getAccessToken();
    if (!active || !token) throw new ApiError({ kind: 'http', status: 401, message: 'Expired' });
    verifiedToken = token;
    pinned = new ApiClient({
      baseUrl: window.location.origin + '/api/session/sys',
      getAccessToken: async () => {
        const current = await session.getAccessToken();
        if (!active || current !== token)
          throw new ApiError({ kind: 'http', status: 401, message: 'Session changed' });
        return token;
      },
      maxAttempts: 1,
    });
    return settingsPorts(pinned).actor(signal);
  };
  const current = () => {
    if (!pinned) throw new ApiError({ kind: 'http', status: 401, message: 'Session changed' });
    return settingsPorts(pinned);
  };
  const controller = new SettingsController({
    ports: {
      actor,
      list: (signal) => current().list(signal),
      write: (...args) => current().write(...args),
    },
    storage: {
      getItem: (key) => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
      removeItem: (key) => window.sessionStorage.removeItem(key),
    },
    createId: () => crypto.randomUUID(),
    now: Date.now,
  });
  return {
    controller,
    dispose: () => {
      active = false;
      controller.dispose();
      session.dispose();
    },
  };
}
