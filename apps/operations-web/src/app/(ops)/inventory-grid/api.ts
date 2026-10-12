import { ApiClient, ApiError, type Decoder } from '@pinehill/api-client';
import {
  inventoryGridQuerySchema,
  inventoryGridSchema,
  listResponseSchema,
  propertySummarySchema,
  roomTypeSummarySchema,
  type ListPage,
} from '@pinehill/contracts';
import { createSessionClient } from '@pinehill/web-session/client';
import { GridController, type GridPort } from './controller';
import { projectGrid } from './model';
import { defaultRange } from '../../../lib/inventory-grid';
function complete(count: number, total: number): void {
  if (count !== total) throw new ApiError({ kind: 'protocol', message: 'Incomplete catalogue' });
}
async function catalogue<T extends { id: string }>(
  client: ApiClient,
  path: string,
  decoder: Decoder<ListPage<T>>,
  signal: AbortSignal,
  propertyId?: string,
): Promise<T[]> {
  const rows: T[] = [],
    seenIds = new Set<string>(),
    seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = (
      await client.request({
        method: 'GET',
        path,
        decoder,
        signal,
        maxAttempts: 1,
        query: { limit: 100, ...(propertyId ? { propertyId } : {}), ...(cursor ? { cursor } : {}) },
      })
    ).data;
    for (const row of page.data) {
      if (seenIds.has(row.id))
        throw new ApiError({ kind: 'protocol', message: 'Duplicate catalogue entry' });
      seenIds.add(row.id);
      rows.push(row);
    }
    if (!page.meta.hasMore) {
      complete(rows.length, page.meta.total);
      return rows;
    }
    const next = page.meta.nextCursor;
    if (!next || seenCursors.has(next) || !page.data.length)
      throw new ApiError({ kind: 'protocol', message: 'Invalid catalogue cursor' });
    seenCursors.add(next);
    cursor = next;
  }
}
export function gridPort(client: ApiClient): GridPort {
  return async (propertyId, range, signal) => {
    const properties = await catalogue(
      client,
      '/properties',
      listResponseSchema(propertySummarySchema),
      signal,
    );
    const chosen = propertyId || properties[0]?.id || '';
    const names = properties.map((p) => ({ id: p.id, name: p.name }));
    if (!chosen) return { propertyId: '', range, properties: names, rows: [], capturedAt: null };
    const types = await catalogue(
      client,
      '/room-types',
      listResponseSchema(roomTypeSummarySchema),
      signal,
      chosen,
    );
    if (!types.length)
      return { propertyId: chosen, range, properties: names, rows: [], capturedAt: null };
    const grid = (
      await client.request({
        method: 'GET',
        path: '/inventory/grid',
        query: inventoryGridQuerySchema.parse({ propertyId: chosen, ...range }),
        decoder: inventoryGridSchema,
        signal,
        maxAttempts: 1,
      })
    ).data;
    return { ...projectGrid(chosen, range, types, grid), properties: names };
  };
}
export function createGridWorkspace(range = defaultRange(new Date())) {
  let active = true,
    lastToken: string | undefined;
  const session = createSessionClient({
    kind: 'staff',
    onExpired: () => controller.deny('expired'),
    onSessionChanged: (token) => {
      if (lastToken && lastToken !== token) {
        lastToken = token ?? undefined;
        controller.invalidate();
        if (token) void controller.load(controller.state.propertyId, controller.state.range);
        else controller.deny('expired');
      }
    },
  });
  const client = new ApiClient({
    baseUrl: window.location.origin + '/api/session/sys',
    getAccessToken: async () => {
      if (!active) throw new ApiError({ kind: 'aborted', message: 'Unmounted' });
      const token = await session.getAccessToken();
      if (!active || !token) throw new ApiError({ kind: 'http', status: 401, message: 'Expired' });
      lastToken = token;
      return token;
    },
    maxAttempts: 1,
  });
  const controller = new GridController(gridPort(client), range);
  return {
    controller,
    dispose: () => {
      active = false;
      controller.dispose();
      session.dispose();
    },
  };
}
