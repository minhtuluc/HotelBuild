import { createJourneyHandler } from '@pinehill/web-session/server';
import { adrRevparReportQuerySchema, adrRevparReportSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/reports/adr-revpar'
        ? {
            method: 'GET',
            path: '/reports/adr-revpar',
            protected: true,
            decoder: adrRevparReportSchema,
            query: (input) => adrRevparReportQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
