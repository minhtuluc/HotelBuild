import { createJourneyHandler } from '@pinehill/web-session/server';
import { listResponseSchema } from '@pinehill/contracts';
import { strictPlan, configQuery } from '../../../../../../lib/rate-config-schemas';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/rate-plans/admin'
        ? {
            method: 'GET',
            path: '/rate-plans/admin',
            protected: true,
            query: (input) => configQuery.parse(input),
            decoder: listResponseSchema(strictPlan),
          }
        : undefined,
  })(request);
}
