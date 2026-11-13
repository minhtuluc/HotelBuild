/** HB-244: client ảnh công khai — đúng tuyến, `If-Match`, thân lệnh và chặn ảnh sai trước khi gửi. */
import { describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client.js';
import { createPhotoApi } from '../src/photos.js';

const PHOTO = {
  url: '/images/pine-hill/hang-STD.webp',
  alt: 'Phòng Standard',
  width: 1200,
  height: 900,
};
const ETAG = '"0123456789abcdef0123456789abcdef"';

interface Seen {
  method: string;
  url: string;
  ifMatch: string | null;
  body: string;
}

function harness(routes: Record<string, { status: number; body?: unknown }>) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    seen.push({
      method,
      url: url.pathname,
      ifMatch: headers.get('if-match'),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const outcome = routes[`${method} ${url.pathname}`] ?? { status: 404, body: {} };
    return Promise.resolve(
      new Response(outcome.body === undefined ? null : JSON.stringify(outcome.body), {
        status: outcome.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const client = new ApiClient({
    baseUrl: 'http://api.test/api/v1',
    fetchImpl,
    sleep: async () => undefined,
    getAccessToken: () => 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  return { api: createPhotoApi(client), seen };
}

describe('HB-244: ảnh công khai', () => {
  it('đọc ETag rồi thay danh sách kèm If-Match; ảnh sai định dạng bị chặn trước khi gửi', async () => {
    const { api, seen } = harness({
      'GET /api/v1/room-types/rt1/photos': { status: 200, body: { photos: [PHOTO], etag: ETAG } },
      'PUT /api/v1/room-types/rt1/photos': { status: 204 },
    });
    const current = await api.list('room-types', 'rt1');
    expect(current.data).toEqual({ photos: [PHOTO], etag: ETAG });
    const done = await api.replace(
      'room-types',
      'rt1',
      { photos: [PHOTO], reason: 'Ảnh mới' },
      current.data.etag,
    );
    expect(done.status).toBe(204);
    expect(seen[1]).toMatchObject({
      method: 'PUT',
      url: '/api/v1/room-types/rt1/photos',
      ifMatch: ETAG,
    });
    expect(JSON.parse(seen[1]!.body)).toEqual({ photos: [PHOTO], reason: 'Ảnh mới' });
    expect(() =>
      api.replace(
        'room-types',
        'rt1',
        { photos: [{ ...PHOTO, url: 'http://insecure/a.webp' }], reason: 'x' },
        ETAG,
      ),
    ).toThrow();
    expect(seen).toHaveLength(2);
  });

  it('đọc loại phòng công khai', async () => {
    const { api } = harness({
      'GET /api/v1/public/room-types/rt1': {
        status: 200,
        body: {
          id: 'rt1',
          propertyId: 'p1',
          code: 'STD',
          name: 'Standard',
          capacityAdults: 2,
          capacityChildren: 1,
          photos: [PHOTO],
        },
      },
    });
    expect((await api.publicRoomType('rt1')).data).toMatchObject({ code: 'STD', photos: [PHOTO] });
  });
});
