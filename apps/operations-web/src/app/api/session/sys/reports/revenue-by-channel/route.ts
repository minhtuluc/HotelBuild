import { createJourneyHandler } from '@pinehill/web-session/server';
import { revenueByChannelQuerySchema, revenueByChannelReportSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' &&
      new URL(req.url).pathname === '/api/session/sys/reports/revenue-by-channel'
        ? {
            method: 'GET',
            path: '/reports/revenue-by-channel',
            protected: true,
            decoder: revenueByChannelReportSchema,
            query: (input) => revenueByChannelQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
