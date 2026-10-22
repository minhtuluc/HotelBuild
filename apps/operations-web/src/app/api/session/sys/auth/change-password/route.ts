import { createJourneyHandler } from '@pinehill/web-session/server';
import { changePasswordRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
/** HB-020 — đổi mật khẩu của chính mình qua BFF; 204 không thân. Chuyển tiếp `POST /auth/change-password`. */
export async function POST(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'POST' && new URL(req.url).pathname === '/api/session/sys/auth/change-password'
        ? {
            method: 'POST',
            path: '/auth/change-password',
            protected: true,
            body: changePasswordRequestSchema,
          }
        : undefined,
  })(request);
}
