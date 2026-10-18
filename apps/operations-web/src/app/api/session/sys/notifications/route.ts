import { createJourneyHandler } from '@pinehill/web-session/server';
import {
  listResponseSchema,
  notificationQuerySchema,
  notificationSummarySchema,
} from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/notifications'
        ? {
            method: 'GET',
            path: '/notifications',
            protected: true,
            decoder: listResponseSchema(notificationSummarySchema),
            query: (input) => notificationQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
