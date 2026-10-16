/**
 * HB-054 AC3 — mùa & hệ số mùa: khoảng ngày/hệ số hợp lệ, chồng lấn được phép, chọn đúng mùa thắng
 * (TC-RATE-03) và cảnh báo + AuditLog khi hai mùa cùng `priority` chồng nhau (BR-RATE-05).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { test, expect } from 'vitest';
import {
  errorBodySchema,
  listResponseSchema,
  rateCalendarSchema,
  seasonSummarySchema,
} from '@pinehill/contracts';
import { calendarRequest, createSeasonRequest, seasonListRequest } from './requests.js';
import { http, insertSeason, login, otherPropertyId, propertyId, rows, typeId } from './fixture.js';

// `propertyId` là binding `let` được nạp trong `beforeAll` của fixture, nên thân lệnh phải dựng lúc chạy.
const seasonBody = () => ({
  propertyId,
  name: 'Mùa mới',
  startDate: '2027-07-01',
  endDate: '2027-07-31',
  multiplier: 1.35,
  priority: 40,
  weekendSurchargeEnabled: true,
});

const createdSeason = z.object({
  propertyId: z.string(),
  name: z.string(),
  code: z.string(),
  priority: z.number(),
  overlappingSamePrioritySeasonIds: z.array(z.string()),
});

const entriesFor = async (token: string, date: string) =>
  rateCalendarSchema.parse((await calendarRequest(token, typeId, { from: date, to: date })).body)
    .entries;

test('AC3 — POST seasons lưu mùa, suy mã theo bảng BR-RATE-05 §4.2 và GET trả đúng hợp đồng', async () => {
  const token = await login('OWNER');
  const response = await createSeasonRequest(token, seasonBody());
  expect(response.status, JSON.stringify(response.body)).toBe(201);

  const stored = (
    await rows(
      "SELECT id::text AS id, code, name, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, multiplier::text AS multiplier, priority, weekend_surcharge_enabled, version::text AS version FROM seasons",
    )
  )[0]!;
  const seasonId = String(stored.id);
  expect(stored).toEqual({
    id: seasonId,
    code: 'SE-SUM',
    name: 'Mùa mới',
    start_date: '2027-07-01',
    end_date: '2027-07-31',
    multiplier: '1.350',
    priority: 40,
    weekend_surcharge_enabled: true,
    version: '1',
  });

  const page = listResponseSchema(seasonSummarySchema).parse(
    (await seasonListRequest(token, { propertyId })).body,
  );
  expect(page.data).toEqual([
    {
      id: seasonId,
      propertyId,
      name: 'Mùa mới',
      startDate: '2027-07-01',
      endDate: '2027-07-31',
      multiplier: 1.35,
      priority: 40,
      weekendSurchargeEnabled: true,
      version: 1,
    },
  ]);
  expect(page.meta).toEqual({ limit: 50, nextCursor: null, hasMore: false, total: 1 });
});

test('AC3 — đầu vào mùa hỏng bị chặn 422/404 và không ghi bản ghi nào', async () => {
  const token = await login('OWNER');
  const cases: readonly [Record<string, unknown>, string][] = [
    [{ ...seasonBody(), name: '   ' }, 'REQUIRED'],
    [{ ...seasonBody(), startDate: '2027-02-30', endDate: '2027-03-02' }, 'INVALID_DATE'],
    [{ ...seasonBody(), startDate: '2027-08-31', endDate: '2027-08-01' }, 'BEFORE_START'],
    [{ ...seasonBody(), multiplier: 0.05 }, 'INVALID_VALUE'],
    [{ ...seasonBody(), multiplier: 6 }, 'INVALID_VALUE'],
    [{ ...seasonBody(), multiplier: 1.2345 }, 'SCALE_EXCEEDS_3'],
    [{ ...seasonBody(), priority: 40000 }, 'OUT_OF_RANGE'],
  ];
  for (const [body, issue] of cases) {
    const response = await createSeasonRequest(token, body);
    expect(response.status, JSON.stringify(body)).toBe(422);
    const error = errorBodySchema.parse(response.body);
    expect(error.code).toBe('E_RATE_CONFIGURATION_INVALID');
    expect(error.details?.[0]?.issue).toBe(issue);
  }
  const missingProperty = await createSeasonRequest(token, {
    ...seasonBody(),
    propertyId: randomUUID(),
  });
  expect(missingProperty.status).toBe(404);
  expect(Number((await rows('SELECT count(*)::int AS n FROM seasons'))[0]!.n)).toBe(0);
});

test('AC3/TC-RATE-03 — ba mùa chồng nhau: priority → khoảng hẹp hơn → createdAt nhỏ hơn thắng', async () => {
  const token = await login('OWNER');
  const wide = await createSeasonRequest(token, {
    propertyId,
    name: 'Lễ 30/4 toàn cơ sở',
    startDate: '2027-04-28',
    endDate: '2027-05-03',
    multiplier: 1.8,
    priority: 80,
    weekendSurchargeEnabled: false,
  });
  expect(wide.status).toBe(201);
  const narrow = await createSeasonRequest(token, {
    propertyId,
    name: 'Nội bộ 30/4',
    startDate: '2027-04-30',
    endDate: '2027-05-01',
    multiplier: 1.5,
    priority: 80,
    weekendSurchargeEnabled: false,
  });
  expect(narrow.status).toBe(201);
  // Mùa thứ ba cùng priority, cùng độ dài khoảng nhưng tạo **sau**; mã mùa khác (bản ghi kiểu nhập
  // lịch toàn chuỗi) nên không đụng `uq_seasons_scope_code_start` — engine chỉ so priority/khoảng/createdAt.
  await insertSeason({
    code: 'SE-SUM',
    name: 'Bản nhập muộn',
    startDate: '2027-04-30',
    endDate: '2027-05-01',
    multiplier: 1.2,
    priority: 80,
    weekendSurchargeEnabled: false,
    createdAt: new Date(Date.now() + 60_000).toISOString(),
  });

  // Đêm 30/4: mùa hẹp hơn thắng mùa rộng, mùa tạo muộn thua vì `createdAt` lớn hơn, và chỉ một mùa được áp.
  expect((await entriesFor(token, '2027-04-30'))[0]).toMatchObject({
    date: '2027-04-30',
    source: 'BASE',
    seasonName: 'Nội bộ 30/4',
    seasonMultiplier: 1.5,
    weekendMultiplier: 1,
    nightlyPrice: 975_000,
  });
  expect(
    listResponseSchema(seasonSummarySchema).parse(
      (await seasonListRequest(token, { propertyId })).body,
    ).data,
  ).toHaveLength(3);
  const warnings = rateCalendarSchema.parse(
    (await calendarRequest(token, typeId, { from: '2027-04-30', to: '2027-04-30' })).body,
  ).warnings;
  expect(warnings?.some((warning) => warning.includes('chồng lấn cùng priority 80'))).toBe(true);
});

test('AC3/BR-RATE-05 — hai mùa cùng priority chồng nhau vẫn được lưu và ghi vào AuditLog', async () => {
  const token = await login('OWNER');
  await createSeasonRequest(token, {
    propertyId,
    name: 'Mùa A',
    startDate: '2027-06-01',
    endDate: '2027-06-30',
    multiplier: 1.2,
    priority: 50,
    weekendSurchargeEnabled: true,
  });
  const overlap = await createSeasonRequest(token, {
    propertyId,
    name: 'Mùa B',
    startDate: '2027-06-10',
    endDate: '2027-06-20',
    multiplier: 1.3,
    priority: 50,
    weekendSurchargeEnabled: true,
  });
  expect(overlap.status).toBe(201);

  const audit = (
    await rows(
      "SELECT after_json, entity_type FROM audit_logs WHERE action='SEASON_CREATED' ORDER BY chain_seq DESC LIMIT 1",
    )
  )[0]!;
  expect(audit.entity_type).toBe('Season');
  const snapshot = createdSeason.parse(audit.after_json);
  expect(snapshot).toMatchObject({ name: 'Mùa B', priority: 50 });
  expect(snapshot.overlappingSamePrioritySeasonIds).toEqual([
    (await rows('SELECT id::text AS id FROM seasons WHERE name=$1', ['Mùa A']))[0]!.id,
  ]);

  // Đêm 15/6 vẫn có giá: mùa hẹp hơn thắng, và cảnh báo được trả cho màn hình cấu hình.
  expect((await entriesFor(token, '2027-06-15'))[0]).toMatchObject({
    seasonName: 'Mùa B',
    seasonMultiplier: 1.3,
  });
  expect(Number((await rows('SELECT count(*)::int AS n FROM outbox_events'))[0]!.n)).toBe(2);
});

test('AC3 — trùng (cơ sở, mã suy ra, ngày bắt đầu) là 422 E_RATE_CONFIGURATION_INVALID', async () => {
  const token = await login('OWNER');
  expect((await createSeasonRequest(token, seasonBody())).status).toBe(201);
  const duplicate = await createSeasonRequest(token, { ...seasonBody(), name: 'Mùa trùng' });
  expect(duplicate.status).toBe(422);
  expect(errorBodySchema.parse(duplicate.body).details).toEqual([
    { field: 'startDate', issue: 'DUPLICATE_SEASON' },
  ]);
  expect(Number((await rows('SELECT count(*)::int AS n FROM seasons'))[0]!.n)).toBe(1);
});

test('RBAC — POST seasons chỉ OWNER; MANAGER chỉ thấy mùa trong phạm vi cơ sở', async () => {
  const owner = await login('OWNER');
  expect((await createSeasonRequest(owner, seasonBody())).status).toBe(201);
  await insertSeason({
    property: otherPropertyId,
    code: 'SE-LOW',
    name: 'Mùa cơ sở khác',
    startDate: '2027-10-01',
    endDate: '2027-10-31',
    multiplier: 0.9,
    priority: 20,
  });

  expect((await http().get('/api/v1/seasons')).status).toBe(401);
  expect((await seasonListRequest(await login('FRONT_DESK'))).status).toBe(403);
  expect((await createSeasonRequest(await login('MANAGER'), seasonBody())).status).toBe(403);
  const scoped = listResponseSchema(seasonSummarySchema).parse(
    (await seasonListRequest(await login('MANAGER'))).body,
  );
  expect(scoped.data.map((season) => season.name)).toEqual(['Mùa mới']);

  const outOfScope = await seasonListRequest(await login('MANAGER'), {
    propertyId: otherPropertyId,
  });
  expect(outOfScope.status).toBe(403);
  expect(errorBodySchema.parse(outOfScope.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
  const all = listResponseSchema(seasonSummarySchema).parse(
    (await seasonListRequest(await login('OWNER'))).body,
  );
  expect(all.data.map((season) => season.name).sort()).toEqual(['Mùa cơ sở khác', 'Mùa mới']);
});

test('GET seasons — phân trang con trỏ, lọc khoảng ngày và đầu vào hỏng', async () => {
  const token = await login('OWNER');
  for (const [code, start, end] of [
    ['SE-NY', '2027-12-30', '2028-01-02'],
    ['SE-REUN', '2028-04-28', '2028-05-03'],
    ['SE-SUM', '2028-06-01', '2028-08-15'],
  ] as const)
    await insertSeason({
      code,
      name: `Mùa ${code}`,
      startDate: start,
      endDate: end,
      multiplier: 1.1,
      priority: 30,
    });

  const first = listResponseSchema(seasonSummarySchema).parse(
    (await seasonListRequest(token, { propertyId, limit: 2 })).body,
  );
  expect(first.meta).toMatchObject({ total: 3, limit: 2, hasMore: true });
  const second = listResponseSchema(seasonSummarySchema).parse(
    (await seasonListRequest(token, { propertyId, limit: 2, cursor: first.meta.nextCursor })).body,
  );
  expect(second.meta.hasMore).toBe(false);
  expect([...first.data, ...second.data].map((season) => season.name).sort()).toEqual([
    'Mùa SE-NY',
    'Mùa SE-REUN',
    'Mùa SE-SUM',
  ]);

  expect(
    listResponseSchema(seasonSummarySchema)
      .parse(
        (await seasonListRequest(token, { propertyId, from: '2028-06-01', to: '2028-06-30' })).body,
      )
      .data.map((season) => season.name),
  ).toEqual(['Mùa SE-SUM']);

  for (const query of [
    { propertyId, limit: 0 },
    { cursor: 'not-a-uuid' },
    { propertyId: 'not-a-uuid' },
    { from: '2027-02-30' },
    { from: '2028-06-02', to: '2028-06-01' },
  ] as const)
    expect((await seasonListRequest(token, query)).status, JSON.stringify(query)).toBe(400);
});

test('POST seasons replay cùng khoá không tạo mùa thứ hai; thiếu khoá là 400', async () => {
  const token = await login('OWNER');
  const key = randomUUID();
  const first = await createSeasonRequest(token, seasonBody(), key);
  const replay = await createSeasonRequest(token, seasonBody(), key);
  expect([first.status, replay.status]).toEqual([201, 201]);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(Number((await rows('SELECT count(*)::int AS n FROM seasons'))[0]!.n)).toBe(1);
  expect(Number((await rows('SELECT count(*)::int AS n FROM outbox_events'))[0]!.n)).toBe(1);
  expect((await createSeasonRequest(token, seasonBody(), null)).status).toBe(400);
});
