import { createJourneyHandler } from '@pinehill/web-session/server';
import { cancelPreviewRequestSchema, cancelPreviewSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../../config/session';
import { decodedId } from '../../../route-id';

export const dynamic = 'force-dynamic';

const ID_PATH = /^\/api\/session\/sys\/bookings\/([^/]+)\/cancel-preview$/;

export async function POST(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: ['reason', 'isForceMajeure'],
    routeResolver: (req) => {
      const id = decodedId(ID_PATH.exec(new URL(req.url).pathname)?.[1] ?? '');
      if (req.method !== 'POST' || id === undefined) return undefined;
      return {
        method: 'POST',
        path: `/bookings/${encodeURIComponent(id)}/cancel-preview`,
        protected: true,
        decoder: cancelPreviewSchema,
        body: cancelPreviewRequestSchema,
      };
    },
  })(request);
}
