import { createJourneyHandler } from '@pinehill/web-session/server';
import { propertySummarySchema, listResponseSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
import { propertyCatalogueQuery } from '../catalogue-query';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/properties'
        ? {
            method: 'GET',
            path: '/properties',
            protected: true,
            decoder: listResponseSchema(propertySummarySchema),
            query: (input) => propertyCatalogueQuery.parse(input),
          }
        : undefined,
  })(request);
}
