/** Logging/error projection only. Keep original request.url for canonical idempotency hashing. */
export const requestPath = (url: string): string => url.split('?')[0]!;
export function serializeSafeRequest(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  const method: unknown = Reflect.get(value, 'method'),
    url: unknown = Reflect.get(value, 'url'),
    id: unknown = Reflect.get(value, 'id');
  return {
    method: typeof method === 'string' ? method : null,
    url: typeof url === 'string' ? requestPath(url) : null,
    id: typeof id === 'string' || typeof id === 'number' ? id : null,
  };
}
