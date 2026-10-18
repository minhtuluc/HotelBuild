/**
 * Đối chiếu bản ghi `Hold` trên Redis với **nguồn chân lý** `bookings.hold_expires_at` (HB-078 AC3,
 * thiet-ke-lop.md §"Hold", kien-truc.md §"Chu kỳ ... đối chiếu cache/hold mỗi 900 giây **chỉ sửa projection**").
 *
 * Bản ghi `hold:<bookingId>` do `HoldProjection` của API ghi là **bộ đếm nhanh**: Redis lỗi thì lệnh giữ chỗ
 * vẫn thành công (HB-076) và job hết hạn 30 giây vẫn nhả tồn theo CSDL. Vì vậy lượt đối chiếu này:
 * 1. sửa lại **projection** cho khớp CSDL: bản ghi còn `ACTIVE` nhưng hold đã hết hiệu lực (`hold_expires_at`
 *    đã qua) đổi thành `EXPIRED`, bản ghi còn `ACTIVE` nhưng booking đã đi tiếp (CONFIRMED/CANCELLED/…) đổi
 *    thành `RELEASED`, bản ghi **mồ côi** (không còn booking) bị xoá;
 * 2. **không** thay job hết hạn: phần nhả tồn vẫn do `expire.ts` làm trên CSDL, Redis không phải điều kiện chạy;
 * 3. đọc **mọi** mốc thời gian so sánh từ `clock_timestamp()` của CSDL (BR-BOOK-18), không dùng đồng hồ tiến trình.
 *
 * Redis hỏng/không truy cập được ⇒ lượt đối chiếu chỉ ghi **mã lỗi an toàn** rồi kết thúc (không ném ra ngoài,
 * không retry dồn dập): phần CSDL đã xong và lượt 900 giây sau sẽ đối chiếu lại.
 */
import { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { redisOptions } from '../../bullmq.factory.js';
import { HOLD_DUE_STATUSES } from './expire.js';

/** Khớp `HOLD_KEY_PREFIX` của API (`apps/api/src/modules/book/holds/projection.ts`) — đổi một bên phải đổi cả hai. */
export const HOLD_PROJECTION_PREFIX = 'hold:';

/** Trạng thái bản ghi Hold (csdl §3 bảng tóm tắt; `00 §7.8` chưa có enum chuẩn). */
export const HOLD_PROJECTION_STATUSES = ['ACTIVE', 'RELEASED', 'EXPIRED'] as const;

/**
 * Gương của `holdRecordSchema` bên API (worker không import được `apps/api`): cùng trường, cùng `strict`-ish
 * nên bản ghi lạ bị coi là không đọc được thay vì đoán bừa rồi sửa nhầm.
 */
export const holdProjectionSchema = z.object({
  id: z.string().min(1),
  // Bản ghi lạ (không phải UUID) phải rơi vào `unreadable` thay vì đi thẳng vào `WHERE id = ANY($1::uuid[])`
  // (Postgres `22P02` sẽ làm **cả** lượt đối chiếu 900 giây bị bỏ, trái chủ đích "bản ghi hỏng chỉ đếm").
  bookingId: z.string().uuid(),
  channelId: z.string().min(1),
  expiresAt: z.string().min(1),
  status: z.enum(HOLD_PROJECTION_STATUSES),
  releasedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  quotedTotal: z.number().int().min(0),
});

export type HoldProjectionRecord = z.infer<typeof holdProjectionSchema>;

/** Cổng Redis tối thiểu mà lượt đối chiếu cần — bơm được để test không phải dựng Redis giả toàn phần. */
export interface HoldProjectionStore {
  /** Khoá theo mẫu, tối đa `limit` khoá (dùng `SCAN`, không `KEYS`). */
  keys(pattern: string, limit: number): Promise<string[]>;
  values(keys: readonly string[]): Promise<(string | null)[]>;
  remove(key: string): Promise<void>;
  /** Ghi đè **giữ nguyên TTL** — đối chiếu không được kéo dài vòng đời hold. */
  set(key: string, value: string): Promise<void>;
}

export interface HoldProjectionSession {
  readonly store: HoldProjectionStore;
  close(): Promise<void>;
}

/**
 * Phiên Redis một lượt: kết nối **lười** (chỉ mở khi thật sự gọi lệnh), không xếp hàng lệnh khi mất kết nối
 * và không tự thử lại — Redis chết thì lỗi nổi lên ngay cho lượt đối chiếu ghi mã an toàn.
 */
export function createHoldProjectionSession(redisUrl: string): HoldProjectionSession {
  const client = new Redis({
    ...redisOptions(redisUrl),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  // ioredis phát lỗi kết nối ra `stderr` thô khi không có listener; ở đây lỗi **không bị nuốt**: mọi lệnh
  // đang chờ bị từ chối và bên gọi (`hold-expiry.job.ts`) ghi đúng một dòng log có mã an toàn.
  client.on('error', () => undefined);
  return {
    store: {
      async keys(pattern, limit) {
        // Kết nối **lười**: chỉ mở khi lượt đối chiếu thật sự cần Redis, và lỗi kết nối nổi lên ngay tại đây
        // (không xếp hàng lệnh, không tự thử lại) để lượt đối chiếu ghi mã an toàn rồi kết thúc.
        if (client.status === 'wait') await client.connect();
        const found: string[] = [];
        let cursor = '0';
        do {
          const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
          cursor = next;
          for (const key of batch) if (found.length < limit) found.push(key);
        } while (cursor !== '0' && found.length < limit);
        return found;
      },
      async values(keys) {
        return keys.length === 0 ? [] : client.mget(...keys);
      },
      async remove(key) {
        await client.del(key);
      },
      async set(key, value) {
        await client.set(key, value, 'KEEPTTL');
      },
    },
    close: async () => {
      if (client.status === 'wait' || client.status === 'end') {
        client.disconnect();
        return;
      }
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

export interface ReconcileOptions {
  /** Trần số khoá mỗi lượt đối chiếu; phần dư để lượt 900 giây sau (không quét vô hạn). */
  readonly maxKeys: number;
}

export interface ReconcileReport {
  readonly scanned: number;
  /** Số bản ghi còn `ACTIVE` (kể cả bản ghi mồ côi vừa bị xoá) — ứng viên của lượt đối chiếu. */
  readonly active: number;
  readonly repaired: number;
  /** Bản ghi không còn booking tương ứng — đã xoá. */
  readonly orphaned: number;
  /** Bản ghi JSON sai hình dạng (bỏ qua, không sửa mù). */
  readonly unreadable: number;
}

interface BookingStateRow {
  readonly id: string;
  readonly status: string;
  readonly hold_expires_at: Date | null;
}

interface ParsedHoldRecords {
  readonly records: Map<string, HoldProjectionRecord>;
  readonly unreadable: number;
}

/**
 * Đọc giá trị thô thành bản ghi hợp lệ. Khoá hết TTL giữa `SCAN` và `MGET` bị bỏ qua (không có gì để đối
 * chiếu), JSON hỏng hoặc sai hình dạng chỉ được **đếm** — không đoán rồi sửa nhầm bản ghi của vận hành.
 */
function parseHoldRecords(
  keys: readonly string[],
  rawValues: readonly (string | null)[],
): ParsedHoldRecords {
  const records = new Map<string, HoldProjectionRecord>();
  let unreadable = 0;
  keys.forEach((key, index) => {
    const raw = rawValues[index];
    if (raw === null || raw === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      unreadable += 1;
      return;
    }
    const record = holdProjectionSchema.safeParse(parsed);
    if (!record.success) {
      unreadable += 1;
      return;
    }
    records.set(key, record.data);
  });
  return { records, unreadable };
}

/** Kết quả quyết định cho một bản ghi projection. */
type ProjectionDecision = 'UNCHANGED' | 'ORPHANED' | 'REPAIRED';

/**
 * Quyết định cho **một** bản ghi theo nguồn chân lý CSDL: xoá nếu mồ côi, sửa nếu hold đã mất hiệu lực (
 * còn `ACTIVE` ⇒ `EXPIRED`/`RELEASED`), bỏ qua khi bản ghi đã đúng hoặc booking vẫn đang chờ còn hạn.
 * Giữ nguyên TTL khi ghi (`store.set`).
 */
async function decideHoldRecord(
  store: HoldProjectionStore,
  key: string,
  record: HoldProjectionRecord,
  booking: BookingStateRow | undefined,
  now: Date,
): Promise<ProjectionDecision> {
  if (record.status !== 'ACTIVE') return 'UNCHANGED';
  if (booking === undefined) {
    await store.remove(key);
    return 'ORPHANED';
  }
  // Đúng điều kiện "còn hiệu lực" của `expire.ts`: booking vẫn chờ và hạn chưa qua (giờ CSDL).
  const live =
    HOLD_DUE_STATUSES.some((status) => status === booking.status) &&
    booking.hold_expires_at !== null &&
    booking.hold_expires_at.getTime() > now.getTime();
  if (live) return 'UNCHANGED';
  const ended = booking.status === 'EXPIRED' || booking.hold_expires_at === null;
  const releasedAt = ended ? (booking.hold_expires_at ?? now) : now;
  await store.set(
    key,
    JSON.stringify({
      ...record,
      status: ended ? 'EXPIRED' : 'RELEASED',
      releasedAt: releasedAt.toISOString(),
    }),
  );
  return 'REPAIRED';
}

/**
 * Một lượt đối chiếu projection. Ném **nguyên** lỗi Redis/CSDL: bên gọi (`hold-expiry.job.ts`) bắt và chỉ ghi
 * mã an toàn, không giấu lỗi lập trình.
 */
export async function reconcileHoldProjection(
  db: PrismaClient,
  store: HoldProjectionStore,
  options: ReconcileOptions,
): Promise<ReconcileReport> {
  const keys = await store.keys(`${HOLD_PROJECTION_PREFIX}*`, options.maxKeys);
  if (keys.length === 0) return { scanned: 0, active: 0, repaired: 0, orphaned: 0, unreadable: 0 };
  const parsed = parseHoldRecords(keys, await store.values(keys));
  const { records, unreadable } = parsed;
  if (records.size === 0) {
    return { scanned: 0, active: 0, repaired: 0, orphaned: 0, unreadable };
  }
  const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  if (clock === undefined) throw new Error('CSDL không trả giờ hiện tại');
  const bookingIds = [...new Set([...records.values()].map((record) => record.bookingId))];
  const rows = await db.$queryRaw<BookingStateRow[]>`
    SELECT id, status, hold_expires_at FROM bookings WHERE id = ANY(${bookingIds}::uuid[])`;
  const byId = new Map(rows.map((row) => [row.id, row]));
  // `active` đếm mọi bản ghi còn `ACTIVE` (kể cả mồ côi vừa bị xoá) — ứng viên của lượt đối chiếu.
  const active = [...records.values()].filter((record) => record.status === 'ACTIVE').length;
  let repaired = 0;
  let orphaned = 0;
  for (const [key, record] of records) {
    const decision = await decideHoldRecord(
      store,
      key,
      record,
      byId.get(record.bookingId),
      clock.now,
    );
    if (decision === 'ORPHANED') orphaned += 1;
    if (decision === 'REPAIRED') repaired += 1;
  }
  return { scanned: records.size, active, repaired, orphaned, unreadable };
}
