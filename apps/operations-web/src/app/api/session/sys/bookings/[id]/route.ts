import { createJourneyHandler } from '@pinehill/web-session/server';
import { bookingDeleteQuerySchema, bookingSummarySchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
import { decodedId } from '../../route-id';

export const dynamic = 'force-dynamic';

const ID_PATH = /^\/api\/session\/sys\/bookings\/([^/]+)$/;

function handler(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: ['reason'],
    routeResolver: (req) => {
      const id = decodedId(ID_PATH.exec(new URL(req.url).pathname)?.[1] ?? '');
      if (!id) return undefined;
      const base = `/bookings/${encodeURIComponent(id)}`;
      if (req.method === 'GET')
        return { method: 'GET', path: base, protected: true, decoder: bookingSummarySchema };
      if (req.method === 'DELETE')
        return {
          method: 'DELETE',
          path: base,
          protected: true,
          query: (input) => bookingDeleteQuerySchema.parse(input),
        };
      return undefined;
    },
  })(request);
}

export async function GET(request: Request): Promise<Response> {
  return handler(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handler(request);
}
