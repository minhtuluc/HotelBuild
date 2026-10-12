import { createJourneyHandler } from '@pinehill/web-session/server';
import { userMeSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/auth/me'
        ? { method: 'GET', path: '/auth/me', protected: true, decoder: userMeSchema }
        : undefined,
  })(request);
}
