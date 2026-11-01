/**
 * Seed kịch bản HB-126 trên CSDL tạm của `fixture.ts`: nhu cầu (booking + assignment), block,
 * ca quá tải dựng sẵn cho đường đọc, và các bẫy ghi để chứng minh tính nguyên tử.
 *
 * Nhu cầu đi theo đúng công thức của engine tồn (`inv/facts/loader.ts` + `packages/domain`):
 * `BookingRoom` đang hiệu lực được đếm kể cả khi chưa gán phòng (cam kết chưa xếp chỗ), hold
 * `HELD`/`PENDING_PAYMENT` chỉ hiệu lực khi `hold_expires_at > now`, `DOR` bán theo giường,
 * `room_blocks` chồng nhau chỉ trừ một lần (BR-INV-01/07, BR-OVER-05).
 */
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { clock, day, rows } from './fixture.js';

export interface Cohort {
  /** Booking `HELD` chưa trả tiền — nhóm `WEAK` của BR-OVER-12, luôn bị điều chuyển trước. */
  readonly weak: string;
  /** `CONFIRMED` đã đóng đủ cọc — `keepScore` thấp trong nhóm `STRONG`. */
  readonly deposit: string;
  /** `CONFIRMED` đã trả đủ — `keepScore` cao hơn. */
  readonly full: string;
}

/** Ba ứng viên khác nhóm/điểm trên một đêm: đủ để kiểm thứ tự BR-OVER-11 và nhóm BR-OVER-12. */
export async function cohortOf(date: string): Promise<Cohort> {
  const weak = await seedDemand({
    start: date,
    end: day(date, 1),
    status: 'HELD',
    holdExpiresAt: new Date(clock.value + 3_600_000),
  });
  const deposit = await seedDemand({ start: date, end: day(date, 1) });
  const full = await seedDemand({ start: date, end: day(date, 1) });
  await rows(
    'UPDATE bookings SET total_amount=1000000, deposit_amount=300000, paid_amount=300000 WHERE id=$1',
    [deposit.bookingId],
  );
  await rows(
    'UPDATE bookings SET total_amount=1000000, deposit_amount=300000, paid_amount=1000000 WHERE id=$1',
    [full.bookingId],
  );
  return { weak: weak.bookingId, deposit: deposit.bookingId, full: full.bookingId };
}

export interface DemandOptions {
  readonly property?: string;
  readonly roomType?: string;
  readonly start: string;
  readonly end: string;
  readonly status?: string;
  readonly count?: number;
  readonly holdExpiresAt?: Date | null;
  readonly channel?: string;
}

export interface SeededDemand {
  readonly bookingId: string;
  readonly bookingRoomId: string;
}

async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

async function bookingCode(): Promise<string> {
  return `PH-270101-${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`;
}

/** Một dòng nhu cầu = một `BookingRoom` của booking mới; không tạo assignment trừ khi được yêu cầu. */
export async function seedDemand(options: DemandOptions): Promise<SeededDemand> {
  const targetProperty = options.property ?? (await defaultPropertyId());
  const targetType = options.roomType ?? (await defaultStdTypeId(targetProperty));
  const channel = await insert('SELECT id FROM channels WHERE code=$1', [options.channel ?? 'WEB']);
  const ratePlan = await insert('SELECT id FROM rate_plans LIMIT 1');
  const guest = await insert(
    "INSERT INTO guests(full_name,phone) VALUES('HB-126 Demand',$1) RETURNING id",
    [
      `+849${randomUUID()
        .replaceAll('-', '')
        .replace(/[^0-9]/gu, '')
        .padEnd(8, '3')
        .slice(0, 8)}`,
    ],
  );
  const bookingId = await insert(
    `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,
        adults,deposit_percent,status,hold_expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,30,$9,$10) RETURNING id`,
    [
      await bookingCode(),
      guest,
      targetProperty,
      targetType,
      ratePlan,
      channel,
      options.start,
      options.end,
      options.status ?? 'CONFIRMED',
      options.holdExpiresAt ?? null,
    ],
  );
  const bookingRoomId = await insert(
    'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,1,100000) RETURNING id',
    [bookingId, targetType],
  );
  return { bookingId, bookingRoomId };
}

async function defaultPropertyId(): Promise<string> {
  return String((await rows("SELECT id FROM properties WHERE code='H029-A'"))[0]!.id);
}

async function defaultStdTypeId(property: string): Promise<string> {
  const found = await rows("SELECT id FROM room_types WHERE property_id=$1 AND code='STD'", [
    property,
  ]);
  return String(found[0]!.id);
}

/** `options.count` dòng nhu cầu cho cùng kỳ/loại phòng; trả danh sách theo thứ tự tạo. */
export async function seedShortage(options: DemandOptions): Promise<SeededDemand[]> {
  const seeded: SeededDemand[] = [];
  for (let index = 0; index < (options.count ?? 1); index += 1)
    seeded.push(await seedDemand(options));
  return seeded;
}

export async function assignUnits(
  bookingRoomId: string,
  room: string,
  start: string,
  end: string,
): Promise<void> {
  await rows(
    'INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date) VALUES($1,$2,0,$3,$4)',
    [bookingRoomId, room, start, end],
  );
}

/** Huỷ nhu cầu (nguồn giảm hợp lệ) để thiếu thực tế về 0 mà không xoá booking. */
export async function cancelDemand(bookings: readonly string[]): Promise<void> {
  await rows(
    "UPDATE bookings SET status='CANCELLED', cancelled_at=clock_timestamp() WHERE id=ANY($1::uuid[])",
    [[...bookings]],
  );
}

export interface CaseSeed {
  readonly propertyId: string;
  readonly date: string;
  readonly roomTypeId: string;
  readonly shortageCount: number;
  readonly status?: 'OPEN' | 'PROPOSED' | 'RESOLVED' | 'ESCALATED';
  readonly detectedAt?: Date;
  readonly escalatedAt?: Date | null;
  readonly delayReason?: string | null;
}

/** Ca dựng sẵn cho **đường đọc**: pha A không được dựa vào scanner để tạo ca. */
export async function seedCase(seed: CaseSeed): Promise<string> {
  const status = seed.status ?? 'OPEN';
  const escalatedAt = status === 'ESCALATED' ? (seed.escalatedAt ?? new Date()) : null;
  return insert(
    `INSERT INTO overbooking_cases(property_id,date,room_type_id,shortage_count,status,detected_at,
        escalated_at,delay_reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      seed.propertyId,
      seed.date,
      seed.roomTypeId,
      seed.shortageCount,
      status,
      seed.detectedAt ?? new Date(),
      escalatedAt,
      seed.delayReason ?? null,
    ],
  );
}

export const caseRows = (property: string) =>
  rows('SELECT * FROM overbooking_cases WHERE property_id=$1 ORDER BY date, id', [property]);

export async function findCase(property: string, date: string, roomType: string) {
  const found = await rows(
    'SELECT * FROM overbooking_cases WHERE property_id=$1 AND date=$2 AND room_type_id=$3',
    [property, date, roomType],
  );
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0];
}

export const caseRow = async (id: string) =>
  (await rows('SELECT * FROM overbooking_cases WHERE id=$1', [id]))[0]!;

export const auditFor = (caseId: string) =>
  rows(
    'SELECT action,actor_id,actor_role,entity_type,at FROM audit_logs WHERE entity_id=$1 ORDER BY chain_seq',
    [caseId],
  );

export const outboxFor = (caseId: string) =>
  rows('SELECT event_type,aggregate_type,payload_json FROM outbox_events WHERE aggregate_id=$1', [
    caseId,
  ]);

/** Dấu "đã báo" của một lần chuyển trạng thái: outbox hoặc notification đều được, nhưng chỉ **một**. */
export async function escalationSignals(caseId: string): Promise<number> {
  const outbox = await rows('SELECT id FROM outbox_events WHERE aggregate_id=$1', [caseId]);
  const notifications = await rows(
    `SELECT n.id FROM notifications n JOIN bookings b ON b.id=n.booking_id
      WHERE n.payload_json->>'caseId'=$1`,
    [caseId],
  );
  return outbox.length + notifications.length;
}

export async function ledgerSnapshot(): Promise<string> {
  const snapshot = await rows(
    `SELECT
       (SELECT count(*)::text FROM payments) AS payments,
       (SELECT count(*)::text FROM booking_charges) AS charges,
       (SELECT count(*)::text FROM payment_allocations) AS allocations,
       (SELECT coalesce(sum(total_amount),0)::text FROM bookings) AS totals,
       (SELECT coalesce(sum(paid_amount),0)::text FROM bookings) AS paid,
       (SELECT count(*)::text FROM room_assignments WHERE released_at IS NULL) AS assignments`,
  );
  return JSON.stringify(snapshot);
}

/** Bảng đích của một lượt quét; đọc sau khi quét để chứng minh không sửa tiền/assignment. */
export const demandRows = (property: string) =>
  rows(
    `SELECT b.id,b.status,b.total_amount,b.paid_amount
       FROM bookings b WHERE b.property_id=$1 ORDER BY b.id`,
    [property],
  );

/**
 * Ép lỗi ghi ca để chứng minh transaction tạo booking/ca là một khối: trigger chạy trước mọi
 * ràng buộc khác và bị dỡ trong `finally` để ca sau không bị ảnh hưởng.
 */
export async function withFailingCaseInsert(run: () => Promise<void>): Promise<void> {
  await rows(
    "CREATE OR REPLACE FUNCTION hb126_case_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic HB-126 case rejection'; END $$",
  );
  await rows(
    'CREATE TRIGGER zz_hb126_case_failure BEFORE INSERT ON overbooking_cases FOR EACH ROW EXECUTE FUNCTION hb126_case_failure()',
  );
  try {
    await run();
  } finally {
    await dropCaseBait();
  }
}

async function dropCaseBait(): Promise<void> {
  await rows('DROP TRIGGER IF EXISTS zz_hb126_case_failure ON overbooking_cases');
  await rows('DROP TRIGGER IF EXISTS zz_hb126_case_gate ON overbooking_cases');
  await rows('DROP FUNCTION IF EXISTS hb126_case_failure()');
  await rows('DROP FUNCTION IF EXISTS hb126_case_gate()');
}

/** Ép lỗi ghi `audit_logs` để chứng minh ca + audit + outbox là một khối (AC9). */
export async function withFailingAuditInsert(run: () => Promise<void>): Promise<void> {
  await rows(
    "CREATE OR REPLACE FUNCTION hb126_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic HB-126 audit rejection'; END $$",
  );
  await rows(
    'CREATE TRIGGER zz_hb126_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION hb126_audit_failure()',
  );
  try {
    await run();
  } finally {
    await rows('DROP TRIGGER IF EXISTS zz_hb126_audit_failure ON audit_logs');
    await rows('DROP FUNCTION IF EXISTS hb126_audit_failure()');
  }
}

/**
 * Chặn lượt ghi ca bằng advisory lock **do test giữ**, để quan sát trạng thái "đang quét" một cách
 * tất định: scheduler đã commit `RUNNING` nhưng chưa ghi ca xong nên `GET` phải thấy `RUNNING`.
 */
export async function withBlockedCaseInsert(
  lockKey: number,
  run: () => Promise<void>,
): Promise<void> {
  await rows(
    `CREATE OR REPLACE FUNCTION hb126_case_gate() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN PERFORM pg_advisory_xact_lock(${Number(lockKey)}); RETURN NEW; END $$`,
  );
  await rows(
    'CREATE TRIGGER zz_hb126_case_gate BEFORE INSERT ON overbooking_cases FOR EACH ROW EXECUTE FUNCTION hb126_case_gate()',
  );
  try {
    await run();
  } finally {
    await dropCaseBait();
  }
}

export const holdLock = (lockKey: number) => rows('SELECT pg_advisory_lock($1)', [lockKey]);

export const releaseLock = (lockKey: number) => rows('SELECT pg_advisory_unlock($1)', [lockKey]);

/** Chờ có điều kiện với hạn cứng — không sleep vô điều kiện, không phụ thuộc máy nhanh/chậm. */
export async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  for (let attempt = 0; attempt < Math.ceil(timeoutMs / 25); attempt += 1) {
    if (await check()) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 25);
    await promise;
  }
  throw new Error(`HB-126: điều kiện không đạt trong ${timeoutMs}ms`);
}

/** `[ngày, thiếu]` theo thứ tự ngày tăng — dạng gọn để so khớp cả bộ ca của một lượt quét. */
export async function caseShortages(
  property: string,
): Promise<{ date: string; shortage: number }[]> {
  const found = await caseRows(property);
  return found.map((row) => ({ date: String(row.date), shortage: Number(row.shortage_count) }));
}
