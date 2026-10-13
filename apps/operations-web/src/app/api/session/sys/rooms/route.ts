import { createJourneyHandler } from '@pinehill/web-session/server';
import { listResponseSchema, roomSummarySchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
import { propertyCatalogueQuery } from '../catalogue-query';
export const dynamic = 'force-dynamic';
const query = propertyCatalogueQuery.extend({
  propertyId: roomSummarySchema.shape.propertyId.optional(),
  roomTypeId: roomSummarySchema.shape.roomTypeId.optional(),
  status: roomSummarySchema.shape.status.optional(),
});
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/rooms'
        ? {
            method: 'GET',
            path: '/rooms',
            protected: true,
            decoder: listResponseSchema(roomSummarySchema),
            query: (input) => query.parse(input),
          }
        : undefined,
  })(request);
}
