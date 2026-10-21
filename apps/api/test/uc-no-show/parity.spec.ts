/**
 * HB-147 — **parity** giữa công thức của worker và engine huỷ (yêu cầu review P2 #2).
 *
 * `apps/worker` không phụ thuộc `@pinehill/domain` nên job `q.no-show-mark` phải tự áp lại cách chia tiền
 * đã thu và cách tính phạt đêm đầu. Test này (chạy trong `apps/api`, nơi import được engine) so **cùng
 * một đầu vào** qua hai đường: `paidShare`/`firstNightPenalty` của worker và
 * `allocatePayment`/`calculateCancellation` của `@pinehill/domain`. Lệch một đồng là đỏ — nhờ vậy drift
 * của engine (kể cả ca phòng đã huỷ từng bị tính sai) không thể lọt.
 */
import { expect, test } from 'vitest';
import { allocatePayment, calculateCancellation } from '@pinehill/domain/cancellation';
import { firstNightPenalty, paidShare } from '../../../worker/src/jobs/no-show/mark.js';

const NIGHTLY = 1_100_000;
const NIGHTS = 2;
const FIRST_NIGHT = 1_100_000;
/** BR-CANCEL-10: no-show luôn rơi vào bậc bắt tất cuối (−1). */
const TIERS = [
  { id: 't1', offsetHours: 168, refundPercent: 100, chargeFirstNight: false },
  { id: 't4', offsetHours: -1, refundPercent: 0, chargeFirstNight: true },
];
const CHECK_IN = Date.UTC(2026, 10, 10, 7, 0, 0); // 14:00 Asia/Ho_Chi_Minh
const NOW = Date.UTC(2026, 10, 10, 16, 59, 0); // 23:59 Asia/Ho_Chi_Minh

const rooms = [
  { id: 'a', firstNight: BigInt(FIRST_NIGHT) },
  { id: 'b', firstNight: BigInt(FIRST_NIGHT) },
];

/** Phạt theo engine cho cùng bộ phòng/tiền: `selected` là phòng bị đánh dấu, phần còn lại đã xử lý. */
function enginePenalty(selected: readonly string[], receipts: readonly number[]): number {
  const weights = rooms.map((room) => ({
    bookingRoomId: room.id,
    weight: NIGHTLY * NIGHTS,
  }));
  const processed = rooms.filter((room) => !selected.includes(room.id)).map((room) => room.id);
  const payments = receipts.map((amount, index) => ({
    ...allocatePayment({ paymentId: `p${index}`, amount, weights }),
    processedRoomIds: processed,
  }));
  const decision = calculateCancellation({
    state: 'CONFIRMED',
    policy: { tiers: TIERS },
    checkInDateTime: CHECK_IN,
    now: NOW,
    rooms: rooms.map((room) => ({
      bookingRoomId: room.id,
      firstNightPrice: Number(room.firstNight),
    })),
    cancelledRoomIds: [...selected],
    processedRoomIds: processed,
    payments,
  });
  return decision.penaltyAmount;
}

/** Phạt theo đường của worker (chia tiền đã thu trên **mọi** phòng, rồi `max(0, firstNight − paid)`). */
function workerPenalty(selected: readonly string[], receipts: readonly number[]): bigint {
  const chosen = new Set(selected);
  const paid = paidShare(
    rooms.map((room) => ({ bookingRoomId: room.id, weight: BigInt(NIGHTLY * NIGHTS) })),
    receipts.map((receipt) => BigInt(receipt)),
    chosen,
  );
  const firstNight = rooms.reduce(
    (sum, room) => (chosen.has(room.id) ? sum + room.firstNight : sum),
    0n,
  );
  return firstNightPenalty(firstNight, paid);
}

test('toàn bộ phòng còn hoạt động: worker và engine ra cùng mức phạt', () => {
  expect(workerPenalty(['a', 'b'], [1_000_000])).toBe(1_200_000n);
  expect(Number(workerPenalty(['a', 'b'], [1_000_000]))).toBe(
    enginePenalty(['a', 'b'], [1_000_000]),
  );
});

test('một phòng đã huỷ: vẫn chia tiền trên mọi phòng ⇒ phạt 600.000, không phải 100.000', () => {
  expect(workerPenalty(['a'], [1_000_000])).toBe(600_000n);
  expect(Number(workerPenalty(['a'], [1_000_000]))).toBe(enginePenalty(['a'], [1_000_000]));
});

test('phần dư chia cho phòng id nhỏ trước: worker và engine khớp từng đồng', () => {
  expect(workerPenalty(['a'], [1_000_001])).toBe(599_999n);
  expect(Number(workerPenalty(['a'], [1_000_001]))).toBe(enginePenalty(['a'], [1_000_001]));
  expect(Number(workerPenalty(['a', 'b'], [1_000_001]))).toBe(
    enginePenalty(['a', 'b'], [1_000_001]),
  );
});

test('chưa thu đồng nào ⇒ phạt đúng giá đêm đầu của các phòng bị đánh dấu', () => {
  expect(workerPenalty(['a'], [])).toBe(1_100_000n);
  expect(Number(workerPenalty(['a'], []))).toBe(enginePenalty(['a'], []));
});
