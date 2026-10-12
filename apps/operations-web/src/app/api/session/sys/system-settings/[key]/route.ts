import { createJourneyHandler } from '@pinehill/web-session/server';
import { systemSettingUpdateRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function PUT(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) => {
      if (req.method !== 'PUT') return undefined;
      const match = /^\/api\/session\/sys\/system-settings\/([A-Za-z0-9_.-]+)$/.exec(
        new URL(req.url).pathname,
      );
      const key = match?.[1];
      if (!key || key === '.' || key === '..') return undefined;
      return {
        method: 'PUT',
        path: '/system-settings/' + encodeURIComponent(key),
        protected: true,
        body: systemSettingUpdateRequestSchema,
      };
    },
  })(request);
}
