import { createJourneyHandler } from '@pinehill/web-session/server';
import { propertySummarySchema, propertyUpdateRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'name',
      'status',
      'overbookLimitPct',
      'checkInTime',
      'checkOutTime',
      'reason',
    ],
    routeResolver: (req) => {
      if (req.method !== 'PATCH') return undefined;
      const id = /^\/api\/session\/sys\/properties\/([A-Za-z0-9_-]+)$/.exec(
        new URL(req.url).pathname,
      )?.[1];
      if (!id) return undefined;
      return {
        method: 'PATCH',
        path: '/properties/' + encodeURIComponent(id),
        protected: true,
        decoder: propertySummarySchema,
        body: propertyUpdateRequestSchema,
      };
    },
  })(request);
}
