import { createSessionHandler } from '@pinehill/web-session/server';
import { sessionConfig } from '../../../../config/session';

export const runtime = 'nodejs';
export function POST(request: Request): Promise<Response> {
  return createSessionHandler({ kind: 'staff', ...sessionConfig() })(request, 'login');
}
