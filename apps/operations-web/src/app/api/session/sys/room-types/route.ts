import { createJourneyHandler } from '@pinehill/web-session/server';
import { roomTypeSummarySchema, listResponseSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
import { typeCatalogueQuery } from '../catalogue-query';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/room-types'
        ? {
            method: 'GET',
            path: '/room-types',
            protected: true,
            decoder: listResponseSchema(roomTypeSummarySchema),
            query: (input) => typeCatalogueQuery.parse(input),
          }
        : undefined,
  })(request);
}
