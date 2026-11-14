import { createJourneyHandler } from '@pinehill/web-session/server';
import { promotionUpdateRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
import { decodedId } from '../../route-id';
export const dynamic = 'force-dynamic';
/** HB-311: sửa / ngừng qua `PUT /promotions/{id}` (chỉ OWNER, `If-Match` + `reason`). */
export async function PUT(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'value',
      'minNights',
      'channelScope',
      'roomTypeScope',
      'validFrom',
      'validTo',
      'maxUses',
      'stackable',
      'status',
      'reason',
    ],
    routeResolver: (req) => {
      if (req.method !== 'PUT') return undefined;
      const raw = /^\/api\/session\/sys\/promotions\/([^/]+)$/.exec(new URL(req.url).pathname)?.[1];
      const id = raw === undefined ? undefined : decodedId(raw);
      if (id === undefined) return undefined;
      return {
        method: 'PUT',
        path: '/promotions/' + encodeURIComponent(id),
        protected: true,
        body: promotionUpdateRequestSchema,
      };
    },
  })(request);
}
