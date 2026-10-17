import { createJourneyHandler } from '@pinehill/web-session/server';
import { operationStatusViewSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
import { decodedId } from '../../route-id';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) => {
      const raw = /^\/api\/session\/sys\/operations\/([^/]+)$/.exec(new URL(req.url).pathname)?.[1];
      const id = raw === undefined ? undefined : decodedId(raw);
      if (req.method !== 'GET' || id === undefined) return undefined;
      return {
        method: 'GET',
        path: '/operations/' + encodeURIComponent(id),
        protected: true,
        decoder: operationStatusViewSchema,
      };
    },
  })(request);
}
