/**
 * HB-076 — `POST /holds` + `DELETE /holds/{holdId}` trên app thật + PostgreSQL 16 + Redis (DB `/15`).
 *
 * Bốn tiêu chí nghiệm thu của ticket:
 * - AC1: khoá theo ADR-014, kiểm tồn bằng engine HB-032 **sau** khoá, `holdExpiresAt` = giờ CSDL +
 *   `Channel.holdMinutes`, kênh `holdMinutes = 0` ⇒ `E_BOOK_INVALID_STATE`;
 * - AC2: tiêu thụ quote qua `RateQuoteService.consume` (HB-074) — lệch/hết hạn trả đúng mã của HB-074;
 * - AC3: booking `HELD` + `booking_rooms` + assignment trong một transaction; `DELETE` giải phóng ngay
 *   và audit cùng transaction;
 * - AC4: 200 yêu cầu song song qua API (pool 50) ⇒ đúng 1 thành công, phần còn lại 409
 *   `E_INV_NO_AVAILABILITY`/`E_INV_ROOM_TAKEN`, không còn assignment mồ côi.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { errorBodySchema, holdSchema, tokenPairSchema } from '@pinehill/contracts';
import { holdRecordSchema } from '../../src/modules/book/holds/projection.js';
import type { Principal } from '../../src/common/idempotency/request.js';
import { block } from '../room-blocks/inventory-seed.js';
import {
  WEB_HOLD_MINUTES,
  clock,
  count,
  createHold,
  guestId,
  guestTokenFor,
  holdBody,
  holdRedis,
  holdRequest,
  http,
  issueQuote,
  otherGuestToken,
  propertyId,
  quoteService,
  releaseRequest,
  roomId,
  room2Id,
  rows,
  rowsOf,
  seedPromotion,
  stay,
  typeId,
  userId,
} from './fixture.js';

const codeOf = (body: unknown): string => errorBodySchema.parse(body).code;
const password = 'Synthetic-HB029-only!';
/** Mã khuyến mãi của ca AC2 (`seedPromotion` bảo đảm nó tồn tại và còn lượt). */
const PROMO_CODE = 'HB076-PROMO';

test('AC1: giữ chỗ ⇒ booking HELD, hạn theo giờ CSDL + holdMinutes, một assignment cho đơn vị bán', async () => {
  const quote = await issueQuote();
  const response = await holdRequest({ ...holdBody(), quoteId: quote.quoteId });
  expect(response.status).toBe(201);
  const hold = holdSchema.parse(response.body);
  expect(hold).toMatchObject({
    bookingStatus: 'HELD',
    status: 'ACTIVE',
    releasedAt: null,
    quotedTotal: quote.total,
  });
  expect(hold.holdId).toBe(hold.bookingId);
  expect(hold.expiresAt).toBe(hold.holdExpiresAt);

  const booking = (
    await rowsOf(
      `SELECT status, room_count, total_amount, created_by,
        extract(epoch FROM (hold_expires_at - clock_timestamp()))::float8 AS seconds_left
      FROM bookings WHERE id=$1`,
      z.object({
        status: z.string(),
        room_count: z.number(),
        total_amount: z.string(),
        created_by: z.string().nullable(),
        seconds_left: z.number(),
      }),
      [hold.bookingId],
    )
  )[0]!;
  expect(booking).toMatchObject({
    status: 'HELD',
    room_count: 1,
    total_amount: String(quote.total),
    created_by: null,
  });
  // Giờ CSDL (ADR-014), không phải giờ tiến trình; dung sai vì đọc ở câu truy vấn khác.
  expect(Math.abs(booking.seconds_left - WEB_HOLD_MINUTES * 60)).toBeLessThan(5);

  const assignments = await rowsOf(
    // `start_date`/`end_date` là cột `date`: đọc thẳng dạng văn bản để không dính dịch chuyển múi giờ
    // của `Date` (node-postgres dựng `date` theo nửa đêm giờ địa phương, ở đây Asia/Saigon +07).
    `SELECT a.room_id, a.bed_no, a.released_at, a.start_date::text AS start_date,
            a.end_date::text AS end_date
      FROM room_assignments a JOIN booking_rooms br ON br.id=a.booking_room_id
      WHERE br.booking_id=$1`,
    z.object({
      room_id: z.string(),
      bed_no: z.number(),
      released_at: z.date().nullable(),
      start_date: z.string(),
      end_date: z.string(),
    }),
    [hold.bookingId],
  );
  expect(assignments).toHaveLength(1);
  // Không ghim phòng cụ thể: engine HB-032 xếp đơn vị theo `rooms.id` (UUID ngẫu nhiên của fixture)
  // nên cả `R1` lẫn `R2` đều là đơn vị hợp lệ — ghim `R1` chỉ tình cờ đúng theo thứ tự UUID.
  expect([roomId, room2Id]).toContain(assignments[0]!.room_id);
  expect(assignments[0]).toMatchObject({ bed_no: 0, released_at: null });
  expect(assignments[0]!.start_date).toBe(stay.checkIn);
  expect(assignments[0]!.end_date).toBe(stay.checkOut);

  const history = await rowsOf(
    'SELECT from_status, to_status FROM booking_status_history WHERE booking_id=$1',
    z.object({ from_status: z.string().nullable(), to_status: z.string() }),
    [hold.bookingId],
  );
  expect(history).toEqual([{ from_status: 'DRAFT', to_status: 'HELD' }]);
  expect(
    await count('SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action=$2', [
      hold.bookingId,
      'HOLD_CREATED',
    ]),
  ).toBe(1);

  // Bản ghi `Hold` của csdl.md §3 là bộ đếm nhanh: TTL đúng hạn giữ chỗ của kênh.
  const record = holdRecordSchema.parse(
    JSON.parse((await holdRedis().get(`hold:${hold.bookingId}`))!),
  );
  expect(record).toMatchObject({ status: 'ACTIVE', bookingId: hold.bookingId, releasedAt: null });
  const ttl = await holdRedis().pttl(`hold:${hold.bookingId}`);
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(WEB_HOLD_MINUTES * 60 * 1000);
});

test('AC1: kênh holdMinutes = 0 ⇒ 409 E_BOOK_INVALID_STATE, không ghi booking/assignment', async () => {
  await rows('UPDATE channels SET hold_minutes=0 WHERE code=$1', ['WEB']);
  try {
    const quote = await issueQuote();
    const response = await holdRequest({ ...holdBody(), quoteId: quote.quoteId });
    expect(response.status).toBe(409);
    expect(codeOf(response.body)).toBe('E_BOOK_INVALID_STATE');
    expect(await count('SELECT 1 FROM bookings')).toBe(0);
    expect(await count('SELECT 1 FROM room_assignments')).toBe(0);
  } finally {
    await rows('UPDATE channels SET hold_minutes=$1 WHERE code=$2', [WEB_HOLD_MINUTES, 'WEB']);
  }
});

test('AC1: sức chứa bị hạ sau khi báo giá ⇒ 422 E_BOOK_OVER_CAPACITY, không ghi booking', async () => {
  const quote = await issueQuote();
  await rows('UPDATE room_types SET capacity_adults=1 WHERE id=$1', [typeId]);
  try {
    const response = await holdRequest({ ...holdBody(), quoteId: quote.quoteId });
    expect(response.status).toBe(422);
    expect(codeOf(response.body)).toBe('E_BOOK_OVER_CAPACITY');
    expect(await count('SELECT 1 FROM bookings')).toBe(0);
  } finally {
    await rows('UPDATE room_types SET capacity_adults=2 WHERE id=$1', [typeId]);
  }
});

test('AC2: quote lệch chủ thể/kỳ, mất cache hoặc hết hạn ⇒ đúng mã của HB-074', async () => {
  const quote = await issueQuote();

  const stranger = await holdRequest(
    { ...holdBody(), quoteId: quote.quoteId },
    { token: otherGuestToken },
  );
  expect(stranger.status).toBe(409);
  expect(codeOf(stranger.body)).toBe('E_RATE_QUOTE_MISMATCH');

  const shifted = await holdRequest({
    ...holdBody({ checkIn: '2026-11-02' }),
    quoteId: quote.quoteId,
  });
  expect(shifted.status).toBe(409);
  expect(codeOf(shifted.body)).toBe('E_RATE_QUOTE_MISMATCH');

  const unknown = await holdRequest({ ...holdBody(), quoteId: randomUUID() });
  expect(unknown.status).toBe(410);
  expect(codeOf(unknown.body)).toBe('E_RATE_QUOTE_EXPIRED');

  // Quá TTL 900 giây của quote: token hết hạn theo cùng đồng hồ nên cấp lại token cho đúng chủ thể.
  clock.value += 16 * 60_000;
  try {
    const fresh = await guestTokenFor(guestId);
    const expired = await holdRequest({ ...holdBody(), quoteId: quote.quoteId }, { token: fresh });
    expect(expired.status).toBe(410);
    expect(codeOf(expired.body)).toBe('E_RATE_QUOTE_EXPIRED');
  } finally {
    clock.value -= 16 * 60_000;
  }
  expect(await count('SELECT 1 FROM bookings')).toBe(0);
});

test('AC2: quote có mã khuyến mãi vẫn giữ chỗ được — gói giá và mã lấy từ bản ghi quote', async () => {
  await seedPromotion(PROMO_CODE);
  // Sàn giá của engine là `room_types.min_price × số đêm`; fixture seed `min_price = base_price` nên
  // mọi ưu đãi đều bị cắt về 0 (`E_RATE_BELOW_FLOOR`). Hạ sàn để mã thật sự được áp, rồi trả lại.
  await rows('UPDATE room_types SET min_price=50000 WHERE id=$1', [typeId]);
  try {
    const plain = await issueQuote();
    const discounted = await issueQuote({ promotionCodes: [PROMO_CODE] });
    // Mã phải thật sự được áp, nếu không ca này không chứng minh được gì.
    expect(discounted.total).toBeLessThan(plain.total);

    // Thân `POST /holds` là `strictObject` **không** khai `promotionCodes`/`ratePlanCode`; trước bản
    // sửa, `consumedInput` băm `promotionCodes = []` nên quote này trả 409 dù hợp lệ.
    const response = await holdRequest({ ...holdBody(), quoteId: discounted.quoteId });
    expect(response.status).toBe(201);
    const hold = holdSchema.parse(response.body);
    expect(hold.quotedTotal).toBe(discounted.total);
    expect(
      await count('SELECT 1 FROM bookings WHERE id=$1 AND total_amount=$2', [
        hold.bookingId,
        String(discounted.total),
      ]),
    ).toBe(1);
  } finally {
    await rows('UPDATE room_types SET min_price=100000 WHERE id=$1', [typeId]);
  }
});

test('AC2: khai mã khuyến mãi/gói giá khác bản ghi quote ⇒ 409 E_RATE_QUOTE_MISMATCH', async () => {
  await seedPromotion(PROMO_CODE);
  const discounted = await issueQuote({ promotionCodes: [PROMO_CODE] });
  const principal: Principal = { type: 'GUEST', id: guestId };
  const body = { ...holdBody(), quoteId: discounted.quoteId };

  // Lệnh không khai hai trường đó ⇒ lấy từ bản ghi ⇒ khớp fingerprint.
  await expect(quoteService().consume(discounted.quoteId, principal, body)).resolves.toBeTruthy();
  // Khai giá trị khác bản ghi ⇒ fingerprint lệch ⇒ 409 (giữ nguyên hợp đồng HB-074).
  await expect(
    quoteService().consume(discounted.quoteId, principal, {
      ...body,
      promotionCodes: ['HB076-OTHER'],
    }),
  ).rejects.toMatchObject({ status: 409, code: 'E_RATE_QUOTE_MISMATCH' });
  await expect(
    quoteService().consume(discounted.quoteId, principal, { ...body, ratePlanCode: 'SAVER3' }),
  ).rejects.toMatchObject({ status: 409, code: 'E_RATE_QUOTE_MISMATCH' });

  // Quote không khuyến mãi: hành vi cũ không đổi.
  const plain = await issueQuote();
  await expect(
    quoteService().consume(plain.quoteId, principal, { ...holdBody(), quoteId: plain.quoteId }),
  ).resolves.toBeTruthy();
});

test('AC3: DELETE giải phóng ngay, trả phòng về tồn khả dụng và ghi audit cùng transaction', async () => {
  await block(room2Id, stay.checkIn, stay.checkOut);
  const first = await createHold();
  const assigned = await rowsOf(
    `SELECT a.room_id FROM room_assignments a JOIN booking_rooms br ON br.id=a.booking_room_id
     WHERE br.booking_id=$1`,
    z.object({ room_id: z.string() }),
    [first.bookingId],
  );
  expect(assigned[0]?.room_id).toBe(roomId);

  const blocked = await holdRequest({
    ...holdBody(),
    quoteId: (await issueQuote()).quoteId,
  });
  expect(blocked.status).toBe(409);
  expect(codeOf(blocked.body)).toBe('E_INV_NO_AVAILABILITY');

  const key = randomUUID();
  expect((await releaseRequest(first.holdId, { key })).status).toBe(204);

  const booking = (
    await rowsOf(
      'SELECT status, cancel_reason, cancelled_at FROM bookings WHERE id=$1',
      z.object({
        status: z.string(),
        cancel_reason: z.string().nullable(),
        cancelled_at: z.date().nullable(),
      }),
      [first.bookingId],
    )
  )[0]!;
  expect(booking.status).toBe('CANCELLED');
  expect(booking.cancel_reason).toBe('GUEST_REQUEST');
  expect(booking.cancelled_at).not.toBeNull();
  const released = await rowsOf(
    `SELECT a.released_at, a.release_reason FROM room_assignments a
     JOIN booking_rooms br ON br.id=a.booking_room_id WHERE br.booking_id=$1`,
    z.object({ released_at: z.date().nullable(), release_reason: z.string().nullable() }),
    [first.bookingId],
  );
  expect(released[0]!.released_at).not.toBeNull();
  expect(
    await count('SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action=$2', [
      first.bookingId,
      'HOLD_RELEASED',
    ]),
  ).toBe(1);
  const record = holdRecordSchema.parse(
    JSON.parse((await holdRedis().get(`hold:${first.holdId}`))!),
  );
  expect(record.status).toBe('RELEASED');

  // Phát lại cùng Idempotency-Key ⇒ 204 (kết quả đã lưu), không giải phóng lần hai.
  expect((await releaseRequest(first.holdId, { key })).status).toBe(204);
  // Lệnh mới trên hold đã kết thúc ⇒ 409 theo hợp đồng tuyến.
  const again = await releaseRequest(first.holdId);
  expect(again.status).toBe(409);
  expect(codeOf(again.body)).toBe('E_BOOK_INVALID_STATE');

  // Phòng đã về tồn khả dụng: giữ lại đúng đơn vị vừa giải phóng.
  const replacement = await createHold();
  expect(replacement.status).toBe('ACTIVE');
  const againAssigned = await rowsOf(
    `SELECT a.room_id FROM room_assignments a JOIN booking_rooms br ON br.id=a.booking_room_id
     WHERE br.booking_id=$1`,
    z.object({ room_id: z.string() }),
    [replacement.bookingId],
  );
  expect(againAssigned[0]?.room_id).toBe(roomId);
});

test('AC3: hold của khách khác ⇒ 404; thiếu lý do ⇒ 400; holdId lạ ⇒ 404', async () => {
  const hold = await createHold();

  const stranger = await releaseRequest(hold.holdId, { token: otherGuestToken });
  expect(stranger.status).toBe(404);
  expect(codeOf(stranger.body)).toBe('E_GEN_NOT_FOUND');

  const noReason = await releaseRequest(hold.holdId, { reason: null });
  expect(noReason.status).toBe(400);
  expect(codeOf(noReason.body)).toBe('E_GEN_VALIDATION_FAILED');

  const unknown = await releaseRequest(randomUUID());
  expect(unknown.status).toBe(404);
  expect(codeOf(unknown.body)).toBe('E_GEN_NOT_FOUND');

  const left = await rowsOf(
    'SELECT status FROM bookings WHERE id=$1',
    z.object({ status: z.string() }),
    [hold.bookingId],
  );
  expect(left[0]?.status).toBe('HELD');
});

test('AC3: lễ tân trong phạm vi giải phóng được hold; ngoài phạm vi ⇒ 403 E_AUTH_OUT_OF_SCOPE', async () => {
  const frontDeskLogin = async () => {
    clock.value += 61_000;
    const response = await http()
      .post('/api/v1/auth/login')
      .send({ username: 'h029-first', password });
    expect(response.status).toBe(200);
    return tokenPairSchema.parse(response.body).accessToken;
  };

  const inScope = await createHold();
  const released = await releaseRequest(inScope.holdId, {
    token: await frontDeskLogin(),
    reason: 'Lễ tân giải phóng hold',
  });
  expect(released.status).toBe(204);

  const outOfScope = await createHold();
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  try {
    const denied = await releaseRequest(outOfScope.holdId, {
      token: await frontDeskLogin(),
      reason: 'Ngoài phạm vi',
    });
    expect(denied.status).toBe(403);
    expect(codeOf(denied.body)).toBe('E_AUTH_OUT_OF_SCOPE');
  } finally {
    await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1,$2)', [
      userId,
      propertyId,
    ]);
  }
});

test('AC4: 200 yêu cầu song song qua API (pool 50) ⇒ đúng 1 thành công, phần còn lại 409, không assignment mồ côi', async () => {
  // Chỉ còn một đơn vị bán cho cả kỳ: R2 bị khoá bảo trì.
  await block(room2Id, stay.checkIn, stay.checkOut);
  const quote = await issueQuote();
  const body = { ...holdBody(), quoteId: quote.quoteId };

  // 200 lệnh **song song**, mỗi lệnh một `Idempotency-Key`. Với `connection_limit=50`, hàng đợi kết nối
  // vượt ngân sách `maxWait` (1 giây) của `IdempotencyStore` (HB-029) nên một phần lệnh nhận
  // `500 E_GEN_SERVICE_UNAVAILABLE` **trước khi use case chạy** — đo trên `HEAD 95997e8` (chưa có bản
  // sửa P2) cho đúng phân bố đó (154 lệnh 500 / 45 lệnh 409), tức không liên quan mã của HB-076. Đấy là
  // tín hiệu "tạm thời không sẵn sàng" mà client phải thử lại, nên harness gửi lại **bằng khoá mới**
  // (đúng chính sách thử lại của client; lệnh 500 không để lại hold) cho tới khi có phán quyết nghiệp
  // vụ. Nhờ vậy **mọi** lệnh đều phải trả lời, còn lỗi hệ thống thật (tái diễn ở mọi lần thử) vẫn đỏ.
  const attempt = async () => {
    for (let tries = 1; ; tries++) {
      const response = await holdRequest(body);
      if (response.status !== 500 || tries >= 8) return response;
    }
  };
  const responses = await Promise.all(Array.from({ length: 200 }, attempt));
  const summary = new Map<string, number>();
  for (const response of responses) {
    const key = `${response.status}:${response.status === 201 ? 'OK' : codeOf(response.body)}`;
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }
  console.warn('AC4 phân bố phản hồi:', [...summary.entries()]);
  const winners = responses.filter((response) => response.status === 201);
  const losers = responses.filter((response) => response.status !== 201);
  expect(winners).toHaveLength(1);
  expect(losers).toHaveLength(199);
  for (const loser of losers) {
    expect(loser.status, `phản hồi thua: ${JSON.stringify(loser.body)}`).toBe(409);
    expect(['E_INV_NO_AVAILABILITY', 'E_INV_ROOM_TAKEN']).toContain(codeOf(loser.body));
  }

  const winner = holdSchema.parse(winners[0]!.body);
  const held = await rowsOf(
    "SELECT id, status FROM bookings WHERE status='HELD'",
    z.object({ id: z.string(), status: z.string() }),
  );
  expect(held).toHaveLength(1);
  expect(held[0]?.id).toBe(winner.bookingId);
  expect(await count('SELECT 1 FROM bookings')).toBe(1);
  expect(await count('SELECT 1 FROM room_assignments WHERE released_at IS NULL')).toBe(1);
  // Không còn assignment mồ côi: mọi assignment đang hoạt động phải thuộc booking HELD duy nhất.
  expect(
    await count(
      `SELECT 1 FROM room_assignments a
          JOIN booking_rooms br ON br.id=a.booking_room_id
          JOIN bookings b ON b.id=br.booking_id
          WHERE a.released_at IS NULL AND b.status <> 'HELD'`,
    ),
  ).toBe(0);
  expect(
    await count(
      `SELECT 1 FROM booking_rooms br LEFT JOIN room_assignments a
          ON a.booking_room_id=br.id AND a.released_at IS NULL
          WHERE a.id IS NULL`,
    ),
  ).toBe(0);
  // Khoá idempotency của lệnh thất bại được bù xoá: chỉ còn kết quả của lệnh thắng. Đếm theo tuyến
  // (`path`) vì `POST /quotes` phát hành quote cho ca này cũng để lại một khoá đã hoàn tất.
  const holdsKeys = "path='/api/v1/holds'";
  expect(
    await count(`SELECT 1 FROM idempotency_keys WHERE status='COMPLETED' AND ${holdsKeys}`),
  ).toBe(1);
  expect(
    await count(`SELECT 1 FROM idempotency_keys WHERE status='IN_PROGRESS' AND ${holdsKeys}`),
  ).toBe(0);
}, 180_000);
