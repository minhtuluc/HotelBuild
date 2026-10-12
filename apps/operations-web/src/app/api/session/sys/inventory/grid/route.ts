import { createJourneyHandler } from '@pinehill/web-session/server';
import { inventoryGridQuerySchema, inventoryGridSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
import { gridDates } from '../../../../../../lib/inventory-grid';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/inventory/grid'
        ? {
            method: 'GET',
            path: '/inventory/grid',
            protected: true,
            decoder: inventoryGridSchema,
            query: (input) => {
              const parsed = inventoryGridQuerySchema.parse(input);
              if (!gridDates(parsed.from, parsed.to).length) throw Error('Invalid range');
              return parsed;
            },
          }
        : undefined,
  })(request);
}
