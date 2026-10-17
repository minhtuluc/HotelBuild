import { createJourneyHandler } from '@pinehill/web-session/server';
import {
  listResponseSchema,
  promotionCreateRequestSchema,
  promotionQuerySchema,
  promotionSummarySchema,
} from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
export const dynamic = 'force-dynamic';
function handler(request: Request) {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'code',
      'type',
      'value',
      'minNights',
      'channelScope',
      'roomTypeScope',
      'validFrom',
      'validTo',
      'maxUses',
      'stackable',
    ],
    routeResolver: (req) => {
      if (new URL(req.url).pathname !== '/api/session/sys/promotions') return undefined;
      if (req.method === 'GET')
        return {
          method: 'GET',
          path: '/promotions',
          protected: true,
          decoder: listResponseSchema(promotionSummarySchema),
          query: (input) => promotionQuerySchema.parse(input),
        };
      if (req.method === 'POST')
        return {
          method: 'POST',
          path: '/promotions',
          protected: true,
          body: promotionCreateRequestSchema,
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
