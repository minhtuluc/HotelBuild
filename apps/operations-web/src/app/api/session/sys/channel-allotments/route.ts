import { createJourneyHandler } from '@pinehill/web-session/server';
import { allotmentRowSchema, listResponseSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
import { allotmentBody, allotmentRead } from './query';
export const dynamic = 'force-dynamic';
async function handler(request: Request): Promise<Response> {
  const fields = ['channelId', 'roomTypeId', 'items', 'reason'];
  const body = {
    parse(value: unknown) {
      const parsed = allotmentBody.parse(value);
      fields.push(...parsed.items.map((item) => `items[${item.date}].allotment`));
      return parsed;
    },
  };
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: fields,
    validationErrorCodes: ['E_INV_ALLOTMENT_EXCEEDS_ROOMS'],
    routeResolver: (req) => {
      if (new URL(req.url).pathname !== '/api/session/sys/channel-allotments') return undefined;
      if (req.method === 'GET')
        return {
          method: 'GET',
          path: '/channel-allotments',
          protected: true,
          decoder: listResponseSchema(allotmentRowSchema),
          query: (input) => allotmentRead.parse(input),
        };
      if (req.method === 'PUT')
        return { method: 'PUT', path: '/channel-allotments', protected: true, body };
      return undefined;
    },
  })(request);
}
export async function GET(request: Request): Promise<Response> {
  return handler(request);
}
export async function PUT(request: Request): Promise<Response> {
  return handler(request);
}
