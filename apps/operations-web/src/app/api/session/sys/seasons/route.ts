import { createJourneyHandler } from '@pinehill/web-session/server';
import {
  listResponseSchema,
  seasonCreateRequestSchema,
  seasonQuerySchema,
  seasonSummarySchema,
} from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
export const dynamic = 'force-dynamic';
function handler(request: Request) {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'propertyId',
      'name',
      'startDate',
      'endDate',
      'multiplier',
      'priority',
      'weekendSurchargeEnabled',
    ],
    routeResolver: (req) => {
      if (new URL(req.url).pathname !== '/api/session/sys/seasons') return undefined;
      if (req.method === 'GET')
        return {
          method: 'GET',
          path: '/seasons',
          protected: true,
          decoder: listResponseSchema(seasonSummarySchema),
          query: (input) => seasonQuerySchema.parse(input),
        };
      if (req.method === 'POST')
        return {
          method: 'POST',
          path: '/seasons',
          protected: true,
          body: seasonCreateRequestSchema,
        };
      return undefined;
    },
  })(request);
}
export async function GET(request: Request): Promise<Response> {
  return handler(request);
}
export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
