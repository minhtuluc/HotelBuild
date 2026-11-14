import { createJourneyHandler } from '@pinehill/web-session/server';
import { seasonUpdateRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
import { decodedId } from '../../route-id';
export const dynamic = 'force-dynamic';
/** HB-310: sửa / ngừng qua `PUT /seasons/{id}` (chỉ OWNER, `If-Match` + `reason`). */
export async function PUT(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'name',
      'startDate',
      'endDate',
      'multiplier',
      'priority',
      'weekendSurchargeEnabled',
      'status',
      'reason',
    ],
    routeResolver: (req) => {
      if (req.method !== 'PUT') return undefined;
      const raw = /^\/api\/session\/sys\/seasons\/([^/]+)$/.exec(new URL(req.url).pathname)?.[1];
      const id = raw === undefined ? undefined : decodedId(raw);
      if (id === undefined) return undefined;
      return {
        method: 'PUT',
        path: '/seasons/' + encodeURIComponent(id),
        protected: true,
        body: seasonUpdateRequestSchema,
      };
    },
  })(request);
}
