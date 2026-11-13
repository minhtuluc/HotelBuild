/**
 * HB-244 (yêu cầu frontend #5) — ảnh công khai của cơ sở và loại phòng:
 * thay cả danh sách bằng `PUT …/photos` (OWNER, `If-Match` = ETag), đọc công khai qua
 * `GET /public/properties`, mục loại phòng của `GET /inventory/availability` và `GET /public/room-types/{id}`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  availabilitySchema,
  errorBodySchema,
  photoListSchema,
  propertyPublicSummarySchema,
  roomTypePublicSchema,
} from '@pinehill/contracts';
import { http, login, otherId, propId, rows, typeId, write } from './fixture.js';

const hero = {
  url: '/images/pine-hill/ga-DL-poster.webp',
  alt: 'Mặt tiền giữa đồi thông',
  width: 1200,
  height: 1600,
};
const room = {
  url: 'https://cdn.example.com/pinehill/std-1.webp',
  alt: 'Phòng Standard',
  width: 1200,
  height: 900,
};

const list = (token: string, owner: 'properties' | 'room-types', id: string) =>
  http().get(`/api/v1/${owner}/${id}/photos`).set('Authorization', `Bearer ${token}`);

async function etagOf(token: string, owner: 'properties' | 'room-types', id: string) {
  const response = await list(token, owner, id);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return photoListSchema.parse(response.body);
}

test('HB244_owner_replaces_property_and_room_type_photos_visible_on_public_reads', async () => {
  await rows('DELETE FROM property_photos');
  await rows('DELETE FROM room_type_photos');
  const owner = await login('OWNER');
  const empty = await etagOf(owner, 'properties', propId);
  expect(empty.photos).toEqual([]);

  const put = await write(
    'put',
    `properties/${propId}/photos`,
    owner,
    {
      photos: [
        hero,
        { ...hero, url: '/images/pine-hill/ga-DL-canh.webp', alt: 'Đồi thông', height: 900 },
      ],
      reason: 'Ảnh mới',
    },
    empty.etag,
  );
  expect(put.status, JSON.stringify(put.body)).toBe(204);
  const typePut = await write(
    'put',
    `room-types/${typeId}/photos`,
    owner,
    { photos: [room], reason: 'Ảnh hạng phòng' },
    (await etagOf(owner, 'room-types', typeId)).etag,
  );
  expect(typePut.status, JSON.stringify(typePut.body)).toBe(204);

  // Công khai: cơ sở có ảnh theo thứ tự; cơ sở khác không bị lẫn.
  const publicList = z
    .object({ data: z.array(propertyPublicSummarySchema) })
    .parse((await http().get('/api/v1/public/properties')).body).data;
  expect(publicList.find((item) => item.id === propId)?.photos?.map((p) => p.url)).toEqual([
    hero.url,
    '/images/pine-hill/ga-DL-canh.webp',
  ]);
  expect(publicList.find((item) => item.id === otherId)?.photos).toEqual([]);

  const detail = await http().get(`/api/v1/public/room-types/${typeId}`);
  expect(detail.status).toBe(200);
  expect(roomTypePublicSchema.parse(detail.body)).toMatchObject({
    id: typeId,
    propertyId: propId,
    code: 'STD',
    photos: [room],
  });

  const availability = await http().get('/api/v1/inventory/availability').query({
    propertyId: propId,
    checkIn: '2026-12-10',
    checkOut: '2026-12-12',
    adults: 2,
    children: 0,
    roomCount: 1,
  });
  expect(availability.status, JSON.stringify(availability.body)).toBe(200);
  const items = availabilitySchema.parse(availability.body).data;
  expect(items.find((item) => item.roomTypeId === typeId)?.photos).toEqual([room]);
  expect(items.find((item) => item.roomTypeCode === 'DOR')?.photos).toEqual([]);

  const audit = await rows(
    "SELECT reason, jsonb_array_length(after_json->'photos') AS n FROM audit_logs WHERE entity_id=$1 AND action='PROPERTY_PHOTOS_REPLACED'",
    [propId],
  );
  expect(audit).toEqual([{ reason: 'Ảnh mới', n: 2 }]);

  // Mảng rỗng = gỡ hết.
  const cleared = await write(
    'put',
    `room-types/${typeId}/photos`,
    owner,
    { photos: [], reason: 'Gỡ ảnh' },
    (await etagOf(owner, 'room-types', typeId)).etag,
  );
  expect(cleared.status).toBe(204);
  expect((await etagOf(owner, 'room-types', typeId)).photos).toEqual([]);
});

test('HB244_etag_guards_validation_and_roles', async () => {
  await rows('DELETE FROM property_photos');
  const owner = await login('OWNER');
  const { etag } = await etagOf(owner, 'properties', propId);
  const body = { photos: [hero], reason: 'x' };

  expect((await write('put', `properties/${propId}/photos`, owner, body)).status).toBe(428);
  const stale = await write(
    'put',
    `properties/${propId}/photos`,
    owner,
    body,
    `"${'0'.repeat(32)}"`,
  );
  expect(stale.status).toBe(412);
  expect(errorBodySchema.parse(stale.body).code).toBe('E_GEN_VERSION_CONFLICT');
  expect((await write('put', `properties/${propId}/photos`, owner, body, etag)).status).toBe(204);
  // ETag cũ sau khi đã thay ⇒ 412 (không ghi đè lặng lẽ).
  expect((await write('put', `properties/${propId}/photos`, owner, body, etag)).status).toBe(412);

  const fresh = (await etagOf(owner, 'properties', propId)).etag;
  for (const photos of [
    [{ ...hero, url: 'http://insecure.example.com/a.webp' }],
    [{ ...hero, url: '/etc/passwd' }],
    [{ ...hero, url: '/images/../secret' }],
    [{ ...hero, alt: ' ' }],
    [{ ...hero, width: 0 }],
    [{ ...hero, extra: true }],
    Array.from({ length: 21 }, () => hero),
  ]) {
    const bad = await write(
      'put',
      `properties/${propId}/photos`,
      owner,
      { photos, reason: 'x' },
      fresh,
    );
    expect(bad.status, JSON.stringify(photos[0])).toBe(400);
  }
  expect(
    (await write('put', `properties/${propId}/photos`, owner, { photos: [hero] }, fresh)).status,
  ).toBe(400);
  expect((await write('put', `properties/${randomUUID()}/photos`, owner, body, fresh)).status).toBe(
    404,
  );
  expect((await http().get(`/api/v1/public/room-types/${randomUUID()}`)).status).toBe(404);
  // Lớp thứ hai: CHECK của CSDL cũng chặn `..` dù lệnh không đi qua hợp đồng.
  await expect(
    rows(
      "INSERT INTO property_photos(property_id, position, url, alt, width, height) VALUES($1, 19, '/images/../x', 'x', 1, 1)",
      [propId],
    ),
  ).rejects.toThrow(/check/i);

  // MANAGER đọc được trong phạm vi, không thay được; ngoài phạm vi ⇒ 403. Gọi cuối vì `login` đổi vai trò.
  const manager = await login('MANAGER');
  expect((await list(manager, 'properties', propId)).status).toBe(200);
  expect((await list(manager, 'properties', otherId)).status).toBe(403);
  expect((await write('put', `properties/${propId}/photos`, manager, body, fresh)).status).toBe(
    403,
  );
  const frontDesk = await login('FRONT_DESK');
  expect((await list(frontDesk, 'properties', propId)).status).toBe(403);
  expect(
    await rows('SELECT count(*)::int AS n FROM property_photos WHERE property_id=$1', [propId]),
  ).toEqual([{ n: 1 }]);
});

test('HB244_public_room_type_hides_inactive_types', async () => {
  await rows("UPDATE room_types SET status='INACTIVE' WHERE id=$1", [typeId]);
  try {
    expect((await http().get(`/api/v1/public/room-types/${typeId}`)).status).toBe(404);
  } finally {
    await rows("UPDATE room_types SET status='ACTIVE' WHERE id=$1", [typeId]);
  }
  expect((await http().get('/api/v1/public/room-types/not-a-uuid')).status).toBe(400);
});
