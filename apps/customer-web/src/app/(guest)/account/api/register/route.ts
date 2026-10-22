import { createAccountHandlers } from '../handlers';
import { sessionConfig } from '../../../../../config/session';

export const runtime = 'nodejs';
export function POST(request: Request): Promise<Response> {
  return createAccountHandlers(sessionConfig()).register(request);
}
