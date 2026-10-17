import { createJourneyHandler } from '@pinehill/web-session/server';
import { quoteRequestSchema, quoteSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'propertyId',
      'roomTypeId',
      'channelCode',
      'ratePlanCode',
      'checkIn',
      'checkOut',
      'adults',
      'children',
      'childAges',
      'roomCount',
      'promotionCodes',
    ],
    routeResolver: (req) =>
      req.method === 'POST' && new URL(req.url).pathname === '/api/session/sys/quotes'
        ? {
            method: 'POST',
            path: '/quotes',
            protected: true,
            decoder: quoteSchema,
            body: quoteRequestSchema,
          }
        : undefined,
  })(request);
}
