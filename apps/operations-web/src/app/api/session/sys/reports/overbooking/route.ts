import { createJourneyHandler } from '@pinehill/web-session/server';
import { overbookingReportQuerySchema, overbookingReportSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/reports/overbooking'
        ? {
            method: 'GET',
            path: '/reports/overbooking',
            protected: true,
            decoder: overbookingReportSchema,
            query: (input) => overbookingReportQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
