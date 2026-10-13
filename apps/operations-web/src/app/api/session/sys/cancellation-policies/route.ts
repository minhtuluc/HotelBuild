import { createJourneyHandler } from '@pinehill/web-session/server';
import { listResponseSchema } from '@pinehill/contracts';
import { strictPolicy, policyQuery } from '../../../../../lib/rate-config-schemas';
import { sessionConfig } from '../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/cancellation-policies'
        ? {
            method: 'GET',
            path: '/cancellation-policies',
            protected: true,
            query: (input) => policyQuery.parse(input),
            decoder: listResponseSchema(strictPolicy),
          }
        : undefined,
  })(request);
}
