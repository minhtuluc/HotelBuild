import { createJourneyHandler } from '@pinehill/web-session/server';
import {
  guestBlacklistReleaseQuerySchema,
  guestBlacklistRequestSchema,
  guestSummarySchema,
} from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../../config/session';
import { decodedId } from '../../../route-id';
export const dynamic = 'force-dynamic';
function handler(request: Request) {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: ['blacklistReason', 'reason'],
    routeResolver: (req) => {
      const raw = /^\/api\/session\/sys\/guests\/([^/]+)\/blacklist$/.exec(
        new URL(req.url).pathname,
      )?.[1];
      const id = raw === undefined ? undefined : decodedId(raw);
      if (id === undefined) return undefined;
      const path = '/guests/' + encodeURIComponent(id) + '/blacklist';
      if (req.method === 'POST')
        return {
          method: 'POST',
          path,
          protected: true,
          decoder: guestSummarySchema,
          body: guestBlacklistRequestSchema,
        };
      if (req.method === 'DELETE')
        return {
          method: 'DELETE',
          path,
          protected: true,
          query: (input) => guestBlacklistReleaseQuerySchema.parse(input),
        };
      return undefined;
    },
  })(request);
}
export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
export async function DELETE(request: Request): Promise<Response> {
  return handler(request);
}
