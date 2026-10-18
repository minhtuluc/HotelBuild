import { createJourneyHandler } from '@pinehill/web-session/server';
import {
  guestCreateRequestSchema,
  guestQuerySchema,
  guestSummarySchema,
  listResponseSchema,
} from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
export const dynamic = 'force-dynamic';
function handler(request: Request) {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'fullName',
      'phone',
      'email',
      'idNumber',
      'dob',
      'nationality',
      'gender',
      'consentMarketing',
      'consentVersion',
      'note',
    ],
    routeResolver: (req) => {
      if (new URL(req.url).pathname !== '/api/session/sys/guests') return undefined;
      if (req.method === 'GET')
        return {
          method: 'GET',
          path: '/guests',
          protected: true,
          decoder: listResponseSchema(guestSummarySchema),
          query: (input) => guestQuerySchema.parse(input),
        };
      if (req.method === 'POST')
        return {
          method: 'POST',
          path: '/guests',
          protected: true,
          decoder: guestSummarySchema,
          body: guestCreateRequestSchema,
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
