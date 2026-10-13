import { createJourneyHandler } from '@pinehill/web-session/server';
import { sessionConfig } from '../../../../../../config/session';
import { blockDeleteQuery } from '../query';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: ['reason'],
    routeResolver: (req) => {
      const id = /^\/api\/session\/sys\/room-blocks\/([A-Za-z0-9_-]+)$/.exec(
        new URL(req.url).pathname,
      )?.[1];
      if (req.method !== 'DELETE' || !id) return undefined;
      return {
        method: 'DELETE',
        path: '/room-blocks/' + encodeURIComponent(id),
        protected: true,
        query: (input) => blockDeleteQuery.parse(input),
      };
    },
  })(request);
}
