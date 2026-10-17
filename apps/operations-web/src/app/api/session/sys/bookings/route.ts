import { createJourneyHandler } from '@pinehill/web-session/server';
import {
  bookingCreateRequestSchema,
  bookingSummarySchema,
  listResponseSchema,
} from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
import { bookingsQuery } from './query';

export const dynamic = 'force-dynamic';

function handler(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'propertyId',
      'roomTypeId',
      'ratePlanCode',
      'channelCode',
      'quoteId',
      'guest.fullName',
      'guest.phone',
      'checkIn',
      'checkOut',
      'adults',
      'children',
      'childAges',
      'roomCount',
      'promotionCodes',
      'note',
    ],
    routeResolver: (req) => {
      if (new URL(req.url).pathname !== '/api/session/sys/bookings') return undefined;
      if (req.method === 'GET')
        return {
          method: 'GET',
          path: '/bookings',
          protected: true,
          decoder: listResponseSchema(bookingSummarySchema),
          query: bookingsQuery,
        };
      if (req.method === 'POST')
        return {
          method: 'POST',
          path: '/bookings',
          protected: true,
          decoder: bookingSummarySchema,
          body: bookingCreateRequestSchema,
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
