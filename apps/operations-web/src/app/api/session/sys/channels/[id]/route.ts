import { createJourneyHandler } from '@pinehill/web-session/server';
import { channelDetailSchema, channelUpdateRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
import { decodedId } from '../../route-id';
export const dynamic = 'force-dynamic';
function handler(request: Request) {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'multiplier',
      'commissionPct',
      'holdMinutes',
      'overbookAllowed',
      'propertyOverrides',
      'reason',
    ],
    routeResolver: (req) => {
      const raw = /^\/api\/session\/sys\/channels\/([^/]+)$/.exec(new URL(req.url).pathname)?.[1];
      const id = raw === undefined ? undefined : decodedId(raw);
      if (id === undefined) return undefined;
      const path = '/channels/' + encodeURIComponent(id);
      if (req.method === 'GET')
        return { method: 'GET', path, protected: true, decoder: channelDetailSchema };
      if (req.method === 'PATCH')
        return { method: 'PATCH', path, protected: true, body: channelUpdateRequestSchema };
      return undefined;
    },
  })(request);
}
export async function GET(request: Request): Promise<Response> {
  return handler(request);
}
export async function PATCH(request: Request): Promise<Response> {
  return handler(request);
}
