import { createJourneyHandler } from '@pinehill/web-session/server';
import { auditLogEntrySchema, auditLogQuerySchema, listResponseSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/audit-logs'
        ? {
            method: 'GET',
            path: '/audit-logs',
            protected: true,
            decoder: listResponseSchema(auditLogEntrySchema),
            query: (input) => auditLogQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
