/**
 * HB-241 (TD-06) — `PUT /seasons/{seasonId}`: sửa hoặc ngừng mùa trên API thật. Trước đây SCR-27 chỉ
 * tạo được; mùa sai hệ số hay sai khoảng ngày không sửa được nếu không đụng thẳng CSDL.
 */
import { expect, test } from 'vitest';
import {
  errorBodySchema,
  listResponseSchema,
  rateCalendarSchema,
  seasonSummarySchema,
} from '@pinehill/contracts';
import { calendarRequest, seasonListRequest, updateSeasonRequest } from './requests.js';
import { insertSeason, login, otherPropertyId, propertyId, rows, typeId } from './fixture.js';

const entryOn = async (token: string, date: string) =>
  rateCalendarSchema.parse((await calendarRequest(token, typeId, { from: date, to: date })).body)
    .entries[0];

const versionOf = async (id: string) =>
  Number((await rows('SELECT version::int AS v FROM seasons WHERE id=$1', [id]))[0]!.v);

test('HB241_owner_edits_season_and_rate_calendar_uses_new_multiplier', async () => {
  const id = await insertSeason({
    code: 'SE-SUM',
    name: 'Hè 2027',
    startDate: '2027-07-01',
    endDate: '2027-07-31',
    multiplier: 1.3,
    priority: 40,
  });
  const owner = await login('OWNER');
  expect(await entryOn(owner, '2027-07-10')).toMatchObject({
    seasonName: 'Hè 2027',
    seasonMultiplier: 1.3,
  });

  const response = await updateSeasonRequest(
    owner,
    id,
    { multiplier: 1.45, name: 'Hè cao điểm', endDate: '2027-08-10', reason: 'Nhu cầu tăng' },
    await versionOf(id),
  );
  expect(response.status, JSON.stringify(response.body)).toBe(204);

  expect(await entryOn(owner, '2027-08-05')).toMatchObject({
    seasonName: 'Hè cao điểm',
    seasonMultiplier: 1.45,
  });
  const audit = await rows(
    "SELECT reason, before_json->>'multiplierExact' AS before, after_json->>'multiplierExact' AS after FROM audit_logs WHERE entity_id=$1 AND action='SEASON_UPDATED'",
    [id],
  );
  expect(audit).toEqual([{ reason: 'Nhu cầu tăng', before: '1.3', after: '1.45' }]);
  expect(
    await rows("SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='RateChanged'", [
      id,
    ]),
  ).toHaveLength(1);
});

test('HB241_deactivated_season_no_longer_prices_and_is_listed_inactive', async () => {
  const id = await insertSeason({
    code: 'SE-SUM',
    name: 'Hè tắt',
    startDate: '2027-07-01',
    endDate: '2027-07-31',
    multiplier: 1.3,
    priority: 40,
  });
  const owner = await login('OWNER');
  const off = await updateSeasonRequest(
    owner,
    id,
    { status: 'INACTIVE', reason: 'Huỷ chương trình' },
    await versionOf(id),
  );
  expect(off.status, JSON.stringify(off.body)).toBe(204);
  const entry = await entryOn(owner, '2027-07-10');
  expect(entry?.seasonName).toBeUndefined();
  expect(entry?.seasonMultiplier).toBe(1);
  expect(
    await rows("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='SEASON_INACTIVE'", [id]),
  ).toHaveLength(1);
  const listed = listResponseSchema(seasonSummarySchema)
    .parse((await seasonListRequest(owner, { propertyId })).body)
    .data.find((season) => season.id === id);
  expect(listed).toMatchObject({ status: 'INACTIVE', version: 2 });

  // Bật lại: mùa trở lại lịch giá.
  const on = await updateSeasonRequest(owner, id, { status: 'ACTIVE', reason: 'Mở lại' }, 2);
  expect(on.status).toBe(204);
  expect(await entryOn(owner, '2027-07-10')).toMatchObject({ seasonName: 'Hè tắt' });
});

test('HB241_merged_rules_and_guards', async () => {
  const id = await insertSeason({
    code: 'SE-SUM',
    name: 'Hè kiểm',
    startDate: '2027-07-01',
    endDate: '2027-07-31',
    multiplier: 1.3,
    priority: 40,
  });
  const owner = await login('OWNER');
  const version = await versionOf(id);
  // Chỉ dời `endDate` vẫn phải ≥ `startDate` đang lưu.
  const before = await updateSeasonRequest(
    owner,
    id,
    { endDate: '2027-06-01', reason: 'x' },
    version,
  );
  expect(before.status).toBe(422);
  expect(errorBodySchema.parse(before.body).details).toContainEqual({
    field: 'endDate',
    issue: 'BEFORE_START',
  });
  const scale = await updateSeasonRequest(owner, id, { multiplier: 1.2345, reason: 'x' }, version);
  expect(scale.status).toBe(422);
  expect(errorBodySchema.parse(scale.body).details).toContainEqual({
    field: 'multiplier',
    issue: 'SCALE_EXCEEDS_3',
  });
  expect((await updateSeasonRequest(owner, id, { reason: 'x' }, version)).status).toBe(422);
  expect((await updateSeasonRequest(owner, id, { propertyId, reason: 'x' }, version)).status).toBe(
    422,
  );
  expect((await updateSeasonRequest(owner, id, { priority: 1, reason: 'x' })).status).toBe(428);
  const stale = await updateSeasonRequest(owner, id, { priority: 1, reason: 'x' }, version + 5);
  expect(stale.status).toBe(412);
  expect(errorBodySchema.parse(stale.body).code).toBe('E_GEN_VERSION_CONFLICT');

  // Mùa toàn chuỗi không đi tuyến này (như `GET /seasons`).
  const chain = await insertSeason({
    property: null,
    code: 'SE-LOW',
    name: 'Toàn chuỗi',
    startDate: '2027-10-01',
    endDate: '2027-10-31',
    multiplier: 0.9,
    priority: 10,
  });
  expect((await updateSeasonRequest(owner, chain, { priority: 2, reason: 'x' }, 1)).status).toBe(
    404,
  );
  const outside = await insertSeason({
    property: otherPropertyId,
    code: 'SE-SUM',
    name: 'Cơ sở khác',
    startDate: '2027-07-01',
    endDate: '2027-07-31',
    multiplier: 1.2,
    priority: 40,
  });
  // OWNER thấy mọi cơ sở; MANAGER không có quyền sửa (gọi cuối vì `login` đổi vai trò user chung).
  expect((await updateSeasonRequest(owner, outside, { priority: 2, reason: 'x' }, 1)).status).toBe(
    204,
  );
  const manager = await updateSeasonRequest(
    await login('MANAGER'),
    id,
    { priority: 2, reason: 'x' },
    version,
  );
  expect(manager.status).toBe(403);
  expect(await rows('SELECT priority FROM seasons WHERE id=$1', [id])).toEqual([{ priority: 40 }]);
});
