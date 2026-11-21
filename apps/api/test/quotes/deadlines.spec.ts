/**
 * HB-245 (yêu cầu frontend #7) — `refundDeadlines` trong báo giá: bậc của chính sách **hiện hành** của gói
 * giá, quy theo giờ nhận phòng của cơ sở. Chính sách không chốt được ⇒ báo giá vẫn 201, chỉ vắng mốc.
 */
import { afterEach, expect, test } from 'vitest';
import { quoteSchema } from '@pinehill/contracts';
import { propertyId, rows } from './fixture.js';
import { quoteBody, quoteRequest } from './requests.js';

const policyId = async () =>
  String(
    (await rows("SELECT cancellation_policy_id AS id FROM rate_plans WHERE code='FLEX7'"))[0]!.id,
  );
let inserted: string | null = null;

afterEach(async () => {
  if (inserted !== null)
    await rows('DELETE FROM cancellation_tiers WHERE policy_id=$1', [inserted]);
  inserted = null;
});

test('HB245_quote_returns_absolute_deadlines_from_current_policy', async () => {
  const policy = await policyId();
  if ((await rows('SELECT 1 FROM cancellation_tiers WHERE policy_id=$1', [policy])).length === 0) {
    await rows(
      `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
       VALUES ($1::uuid,168,100,false,'>=7d',1),($1::uuid,72,50,false,'3-7d',2),($1::uuid,-1,0,true,'<72h',3)`,
      [policy],
    );
    inserted = policy;
  }
  const [property] = await rows(
    "SELECT timezone, to_char(check_in_time,'HH24:MI') AS t FROM properties WHERE id=$1",
    [propertyId],
  );
  expect(property).toEqual({ timezone: 'Asia/Ho_Chi_Minh', t: '14:00' });
  const tiers = await rows(
    'SELECT offset_hours, refund_percent::int AS pct, charge_first_night AS c FROM cancellation_tiers WHERE policy_id=$1 ORDER BY offset_hours DESC',
    [policy],
  );

  const response = await quoteRequest(quoteBody());
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const quote = quoteSchema.parse(response.body);
  // 14:00 giờ VN của ngày nhận phòng = 07:00Z; mỗi bậc `h` giờ ⇒ mốc lùi đúng `h` giờ.
  const checkInMs = Date.parse(`${quote.checkIn}T07:00:00.000Z`);
  expect(quote.refundDeadlines).toEqual(
    tiers.map((tier) => ({
      until:
        Number(tier.offset_hours) >= 0
          ? new Date(checkInMs - Number(tier.offset_hours) * 3_600_000).toISOString()
          : null,
      refundPercent: Number(tier.pct),
      chargeFirstNight: tier.c === true,
    })),
  );
});

test('HB245_quote_without_resolvable_policy_still_succeeds_without_deadlines', async () => {
  const policy = await policyId();
  const saved = await rows(
    'SELECT offset_hours,refund_percent,charge_first_night,label,sort_order FROM cancellation_tiers WHERE policy_id=$1',
    [policy],
  );
  await rows('DELETE FROM cancellation_tiers WHERE policy_id=$1', [policy]);
  try {
    const response = await quoteRequest(quoteBody());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(quoteSchema.parse(response.body).refundDeadlines).toBeUndefined();
  } finally {
    for (const tier of saved)
      await rows(
        'INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order) VALUES($1,$2,$3,$4,$5,$6)',
        [
          policy,
          tier.offset_hours,
          tier.refund_percent,
          tier.charge_first_night,
          tier.label,
          tier.sort_order,
        ],
      );
  }
});
