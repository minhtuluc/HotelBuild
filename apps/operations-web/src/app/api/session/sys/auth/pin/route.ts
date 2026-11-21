import { createJourneyHandler } from '@pinehill/web-session/server';
import { setPinRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
/** Go-live — đặt/đổi PIN của chính mình qua BFF; 204 không thân. Chuyển tiếp `PUT /auth/pin`. */
export async function PUT(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'PUT' && new URL(req.url).pathname === '/api/session/sys/auth/pin'
        ? { method: 'PUT', path: '/auth/pin', protected: true, body: setPinRequestSchema }
        : undefined,
  })(request);
}
