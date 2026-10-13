import { createJourneyHandler } from '@pinehill/web-session/server';
import { channelQuerySchema, channelSummarySchema, listResponseSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/channels'
        ? {
            method: 'GET',
            path: '/channels',
            protected: true,
            decoder: listResponseSchema(channelSummarySchema),
            query: (input) => channelQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
