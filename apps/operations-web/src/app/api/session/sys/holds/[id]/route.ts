import { createJourneyHandler } from '@pinehill/web-session/server';
import { holdReleaseQuerySchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
import { decodedId } from '../../route-id';

export const dynamic = 'force-dynamic';

const ID_PATH = /^\/api\/session\/sys\/holds\/([^/]+)$/;

export async function DELETE(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: ['reason'],
    routeResolver: (req) => {
      const id = decodedId(ID_PATH.exec(new URL(req.url).pathname)?.[1] ?? '');
      if (req.method !== 'DELETE' || id === undefined) return undefined;
      return {
        method: 'DELETE',
        path: `/holds/${encodeURIComponent(id)}`,
        protected: true,
        query: (input) => holdReleaseQuerySchema.parse(input),
      };
    },
  })(request);
}
