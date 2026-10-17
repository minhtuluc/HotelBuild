import { createJourneyHandler } from '@pinehill/web-session/server';
import { operationRefSchema, reportExportRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'POST' && new URL(req.url).pathname === '/api/session/sys/reports/export'
        ? {
            method: 'POST',
            path: '/reports/export',
            protected: true,
            decoder: operationRefSchema,
            body: reportExportRequestSchema,
          }
        : undefined,
  })(request);
}
