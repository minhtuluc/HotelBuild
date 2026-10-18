import { createJourneyHandler } from '@pinehill/web-session/server';
import { occupancyReportQuerySchema, occupancyReportSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/reports/occupancy'
        ? {
            method: 'GET',
            path: '/reports/occupancy',
            protected: true,
            decoder: occupancyReportSchema,
            query: (input) => occupancyReportQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
