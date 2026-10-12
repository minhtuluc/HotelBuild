import { ApiClient, ApiError } from '@pinehill/api-client';
import { auditLogEntrySchema, listResponseSchema, auditLogQuerySchema } from '@pinehill/contracts';
import { createSessionClient } from '@pinehill/web-session/client';
import { AuditController, type AuditPort } from './controller';
export function auditPort(client: ApiClient): AuditPort {
  return async (query, signal) =>
    (
      await client.request({
        method: 'GET',
        path: '/audit-logs',
        query: auditLogQuerySchema.parse(query),
        decoder: listResponseSchema(auditLogEntrySchema),
        signal,
        maxAttempts: 1,
      })
    ).data;
}
/** Staff refresh cookie stays in the existing BFF; only the current memory token reaches API. */
export function createAuditWorkspace(baseUrl: string) {
  let session: ReturnType<typeof createSessionClient> | undefined;
  let active = true;
  const getSession = () =>
    (session ??= createSessionClient({
      kind: 'staff',
      onExpired: () => controller.deny('expired'),
    }));
  const token = async () => {
    if (!active) throw new ApiError({ kind: 'aborted', message: 'Unmounted' });
    const value = await getSession().getAccessToken();
    if (!value || !active)
      throw new ApiError({ kind: 'http', status: 401, message: 'Expired session' });
    return value;
  };
  const client = new ApiClient({
    baseUrl,
    getAccessToken: token,
    onUnauthorized: async (rejected) => Boolean(await getSession().refresh(rejected)),
    maxAttempts: 1,
  });
  const controller = new AuditController(auditPort(client));
  return {
    controller,
    dispose: () => {
      active = false;
      controller.dispose();
      session?.dispose();
    },
  };
}
