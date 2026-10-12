import { createJourneyHandler } from '@pinehill/web-session/server';
import {
  systemSettingQuerySchema,
  systemSettingSchema,
  listResponseSchema,
} from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/system-settings'
        ? {
            method: 'GET',
            path: '/system-settings',
            protected: true,
            decoder: listResponseSchema(systemSettingSchema),
            query: (input) => systemSettingQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
