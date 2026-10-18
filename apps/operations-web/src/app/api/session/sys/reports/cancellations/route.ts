import { createJourneyHandler } from '@pinehill/web-session/server';
import { cancellationsReportQuerySchema, cancellationsReportSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/reports/cancellations'
        ? {
            method: 'GET',
            path: '/reports/cancellations',
            protected: true,
            decoder: cancellationsReportSchema,
            query: (input) => cancellationsReportQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
