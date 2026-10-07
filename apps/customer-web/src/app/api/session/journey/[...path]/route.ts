import { createJourneyHandler } from '@pinehill/web-session/server';
import { sessionConfig } from '../../../../../config/session';
export const runtime = 'nodejs';
function handle(request: Request): Promise<Response> {
  return createJourneyHandler(sessionConfig())(request);
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
