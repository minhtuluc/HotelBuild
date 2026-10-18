import { createJourneyHandler } from '@pinehill/web-session/server';
import { guestLoyaltySchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../../config/session';
import { decodedId } from '../../../route-id';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) => {
      const raw = /^\/api\/session\/sys\/guests\/([^/]+)\/loyalty$/.exec(
        new URL(req.url).pathname,
      )?.[1];
      const id = raw === undefined ? undefined : decodedId(raw);
      if (req.method !== 'GET' || id === undefined) return undefined;
      return {
        method: 'GET',
        path: '/guests/' + encodeURIComponent(id) + '/loyalty',
        protected: true,
        decoder: guestLoyaltySchema,
      };
    },
  })(request);
}
