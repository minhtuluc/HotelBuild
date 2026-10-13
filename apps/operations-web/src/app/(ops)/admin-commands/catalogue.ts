import { ApiError, type ApiClient, type Decoder } from '@pinehill/api-client';
import type { ListPage } from '@pinehill/contracts';
export async function completeCatalogue<T extends { id: string }>(
  client: ApiClient,
  path: string,
  decoder: Decoder<ListPage<T>>,
  signal: AbortSignal,
): Promise<T[]> {
  const result: T[] = [],
    ids = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = (
      await client.request({
        method: 'GET',
        path,
        decoder,
        query: { limit: 100, ...(cursor ? { cursor } : {}) },
        signal,
        maxAttempts: 1,
      })
    ).data;
    for (const row of page.data) {
      if (ids.has(row.id))
        throw new ApiError({ kind: 'protocol', message: 'Duplicate catalogue row' });
      ids.add(row.id);
      result.push(row);
    }
    if (!page.meta.hasMore) {
      if (result.length !== page.meta.total)
        throw new ApiError({ kind: 'protocol', message: 'Incomplete catalogue' });
      return result;
    }
    const next = page.meta.nextCursor;
    if (!next || cursors.has(next) || !page.data.length)
      throw new ApiError({ kind: 'protocol', message: 'Invalid catalogue cursor' });
    cursors.add(next);
    cursor = next;
  }
}
