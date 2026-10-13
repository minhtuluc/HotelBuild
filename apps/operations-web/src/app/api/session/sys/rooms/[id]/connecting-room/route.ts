import { createJourneyHandler } from '@pinehill/web-session/server';
import { roomSummarySchema, connectingRoomRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function PUT(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: ['connectingRoomId'],
    routeResolver: (req) => {
      if (req.method !== 'PUT') return undefined;
      const id = /^\/api\/session\/sys\/rooms\/([A-Za-z0-9_-]+)\/connecting-room$/.exec(
        new URL(req.url).pathname,
      )?.[1];
      if (!id) return undefined;
      return {
        method: 'PUT',
        path: '/rooms/' + encodeURIComponent(id) + '/connecting-room',
        protected: true,
        body: connectingRoomRequestSchema,
        decoder: roomSummarySchema,
      };
    },
  })(request);
}
