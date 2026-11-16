import { createGuestAccountHandler } from '@pinehill/web-session/server';
import { sessionConfig } from '../../../../../config/session';

/** HB-324 (TD-41): lệnh tài khoản khách đi cùng BFF phiên `@pinehill/web-session`. */
export const runtime = 'nodejs';
export function POST(request: Request): Promise<Response> {
  return createGuestAccountHandler(sessionConfig()).resetConfirm(request);
}
