import { createJourneyHandler } from '@pinehill/web-session/server';
import { holdCreateRequestSchema, holdSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'propertyId',
      'roomTypeId',
      'channelCode',
      'checkIn',
      'checkOut',
      'adults',
      'children',
      'childAges',
      'roomCount',
      'quoteId',
    ],
    routeResolver: (req) =>
      req.method === 'POST' && new URL(req.url).pathname === '/api/session/sys/holds'
        ? {
            method: 'POST',
            path: '/holds',
            protected: true,
            decoder: holdSchema,
            body: holdCreateRequestSchema,
          }
        : undefined,
  })(request);
}
