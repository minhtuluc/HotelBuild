import { createJourneyHandler } from '@pinehill/web-session/server';
import { multiChannelQuoteRequestSchema, multiChannelQuoteSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: ['roomTypeId', 'checkIn', 'checkOut', 'channelCodes'],
    routeResolver: (req) =>
      req.method === 'POST' && new URL(req.url).pathname === '/api/session/sys/quotes/multi-channel'
        ? {
            method: 'POST',
            path: '/quotes/multi-channel',
            protected: true,
            decoder: multiChannelQuoteSchema,
            body: multiChannelQuoteRequestSchema,
          }
        : undefined,
  })(request);
}
