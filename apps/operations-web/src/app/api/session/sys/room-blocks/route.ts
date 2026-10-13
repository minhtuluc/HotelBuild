import { createJourneyHandler } from '@pinehill/web-session/server';
import { listResponseSchema, roomBlockSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
import { blockCreateBody, blockListQuery } from './query';
export const dynamic = 'force-dynamic';
function handler(request: Request) {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: ['roomId', 'startDate', 'endDate', 'reason', 'note'],
    routeResolver: (req) => {
      if (new URL(req.url).pathname !== '/api/session/sys/room-blocks') return undefined;
      if (req.method === 'GET')
        return {
          method: 'GET',
          path: '/room-blocks',
          protected: true,
          decoder: listResponseSchema(roomBlockSchema),
          query: (input) => blockListQuery.parse(input),
        };
      if (req.method === 'POST')
        return {
          method: 'POST',
          path: '/room-blocks',
          protected: true,
          decoder: roomBlockSchema,
          body: blockCreateBody,
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
