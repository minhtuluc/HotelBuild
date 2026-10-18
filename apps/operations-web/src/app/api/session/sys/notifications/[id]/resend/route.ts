import { createJourneyHandler } from '@pinehill/web-session/server';
import { notificationResendRequestSchema, notificationSummarySchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../../config/session';
import { decodedId } from '../../../route-id';
export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: ['reason'],
    routeResolver: (req) => {
      const raw = /^\/api\/session\/sys\/notifications\/([^/]+)\/resend$/.exec(
        new URL(req.url).pathname,
      )?.[1];
      const id = raw === undefined ? undefined : decodedId(raw);
      if (req.method !== 'POST' || id === undefined) return undefined;
      return {
        method: 'POST',
        path: '/notifications/' + encodeURIComponent(id) + '/resend',
        protected: true,
        decoder: notificationSummarySchema,
        body: notificationResendRequestSchema,
      };
    },
  })(request);
}
