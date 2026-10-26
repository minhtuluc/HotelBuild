/**
 * HB-211 — công thức phân bổ dùng chung (BR-CANCEL-19).
 *
 * Chốt ba bất biến của hợp đồng:
 * 1. `allocateByWeight` **trùng từng VND** với `allocatePayment` của domain mà engine huỷ dùng để tính
 *    `refundBase` — không có công thức thứ hai.
 * 2. Trọng số phòng = `Σ booking_charges.amount` của phòng, cùng đầu vào với `cancel/context.ts`.
 * 3. Một khoản thu chia hết cho các phòng theo trọng số; trong phòng chia tiếp cho các đêm; không phần
 *    âm, `Σ` phần = số tiền thu (khi còn đủ nghĩa vụ).
 */
import { describe, expect, test } from 'vitest';
import { allocatePayment } from '@pinehill/domain/cancellation';
import {
  allocateByWeight,
  planReceiptAllocation,
  roomWeights,
  type ReceiptCharge,
} from '../../src/modules/pay/ledger/receipt-allocation.js';

/** Ca DLX của F5-QA-04: 2 phòng × 3 đêm, mỗi phòng 3.450.000; cọc 2.070.000. */
const ROOM_WEIGHT = 3_450_000n;
const DEPOSIT = 2_070_000n;
const NIGHT = 1_150_000n;

function chargesOf(rooms: readonly { id: string; weight: bigint }[]): ReceiptCharge[] {
  return rooms.flatMap((room) => {
    const perNight = room.weight / 3n;
    return [0, 1, 2].map((night) => ({
      id: `${room.id}-${night}`,
      kind: 'ROOM',
      roomId: room.id,
      weight: perNight,
      outstanding: perNight,
    }));
  });
}

function perRoom(lines: readonly { chargeId: string; amount: bigint }[]): Map<string, bigint> {
  const total = new Map<string, bigint>();
  for (const line of lines) {
    const room = line.chargeId.split('-')[0]!;
    total.set(room, (total.get(room) ?? 0n) + line.amount);
  }
  return total;
}

describe('allocateByWeight — cùng phép chia với allocatePayment của domain', () => {
  test('số tiền 0 không tạo phần nào', () => {
    expect(allocateByWeight(0n, [{ id: 'a', weight: 9n }])).toEqual([]);
  });

  const cases: readonly { amount: bigint; weights: readonly { id: string; weight: bigint }[] }[] = [
    {
      amount: DEPOSIT,
      weights: [
        { id: 'a', weight: ROOM_WEIGHT },
        { id: 'b', weight: ROOM_WEIGHT },
      ],
    },
    {
      amount: 1_000_001n,
      weights: [
        { id: 'a', weight: 3_450_000n },
        { id: 'b', weight: 2_700_000n },
      ],
    },
    {
      amount: 100n,
      weights: [
        { id: 'r1', weight: 1n },
        { id: 'r2', weight: 1n },
        { id: 'r3', weight: 1n },
      ],
    },
    {
      amount: 7n,
      weights: [
        { id: 'x', weight: 5n },
        { id: 'y', weight: 2n },
      ],
    },
  ];

  for (const item of cases)
    test(`amount=${item.amount} weights=${item.weights.map((w) => `${w.id}:${w.weight}`).join(',')}`, () => {
      const canonical = allocatePayment({
        paymentId: 'payment',
        amount: Number(item.amount),
        weights: item.weights.map((weight) => ({
          bookingRoomId: weight.id,
          weight: Number(weight.weight),
        })),
      });
      const actual = allocateByWeight(item.amount, item.weights);
      expect(actual.map((share) => ({ id: share.id, amount: Number(share.amount) }))).toEqual(
        canonical.allocations.map((allocation) => ({
          id: allocation.bookingRoomId,
          amount: allocation.amount,
        })),
      );
      expect(actual.reduce((sum, share) => sum + share.amount, 0n)).toBe(item.amount);
      for (const share of actual) expect(share.amount >= 0n).toBe(true);
    });
});

describe('trọng số phòng', () => {
  test('Σ đêm của phòng, bỏ dòng thiếu phòng/ngày như context.ts', () => {
    const weights = roomWeights([
      { booking_room_id: 'room-a', stay_date: new Date('2026-11-01'), amount: 1_150_000n },
      { booking_room_id: 'room-a', stay_date: new Date('2026-11-02'), amount: 1_150_000n },
      { booking_room_id: 'room-a', stay_date: new Date('2026-11-03'), amount: 1_150_000n },
      { booking_room_id: 'room-b', stay_date: new Date('2026-11-01'), amount: 900_000n },
      { booking_room_id: null, stay_date: new Date('2026-11-01'), amount: 5n },
      { booking_room_id: 'room-b', stay_date: null, amount: 7n },
    ]);
    expect([...weights.entries()]).toEqual([
      ['room-a', ROOM_WEIGHT],
      ['room-b', 900_000n],
    ]);
  });
});

describe('planReceiptAllocation — ca DLX 2 phòng × 3 đêm', () => {
  test('cọc 2.070.000 chia đều 1.035.000/phòng và 345.000/đêm', () => {
    const lines = planReceiptAllocation(
      DEPOSIT,
      chargesOf([
        { id: 'a', weight: ROOM_WEIGHT },
        { id: 'b', weight: ROOM_WEIGHT },
      ]),
      ['ROOM'],
    );
    expect(perRoom(lines)).toEqual(
      new Map([
        ['a', 1_035_000n],
        ['b', 1_035_000n],
      ]),
    );
    for (const line of lines) expect(line.amount).toBe(345_000n);
    expect(lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(DEPOSIT);
  });

  test('phòng lệch trọng số: Σ phần = số thu, không phần âm, phần dư theo id tăng dần', () => {
    const lines = planReceiptAllocation(
      1_000_001n,
      chargesOf([
        { id: 'a', weight: ROOM_WEIGHT },
        { id: 'b', weight: 2_700_000n },
      ]),
      ['ROOM'],
    );
    const byRoom = perRoom(lines);
    const expected = allocateByWeight(1_000_001n, [
      { id: 'a', weight: ROOM_WEIGHT },
      { id: 'b', weight: 2_700_000n },
    ]);
    expect(byRoom.get('a')).toBe(expected.find((share) => share.id === 'a')!.amount);
    expect(byRoom.get('b')).toBe(expected.find((share) => share.id === 'b')!.amount);
    expect(lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(1_000_001n);
    for (const line of lines) expect(line.amount >= 0n).toBe(true);
  });

  test('không vượt nghĩa vụ còn lại: phòng đã trả đủ nhận 0, tiền dồn sang phòng còn nợ', () => {
    const charges: ReceiptCharge[] = [
      { id: 'a-0', kind: 'ROOM', roomId: 'a', weight: NIGHT, outstanding: 0n },
      { id: 'b-0', kind: 'ROOM', roomId: 'b', weight: NIGHT, outstanding: NIGHT },
    ];
    expect(planReceiptAllocation(500_000n, charges, ['ROOM'])).toEqual([
      { chargeId: 'b-0', amount: 500_000n },
    ]);
  });

  test('đêm đã trả đủ vẫn giữ trọng số phòng: chia theo trọng số gốc, không co lại theo số còn nợ', () => {
    const charges: ReceiptCharge[] = [
      { id: 'a-0', kind: 'ROOM', roomId: 'a', weight: 1_000n, outstanding: 0n },
      { id: 'a-1', kind: 'ROOM', roomId: 'a', weight: 1_000n, outstanding: 1_000n },
      { id: 'b-0', kind: 'ROOM', roomId: 'b', weight: 2_000n, outstanding: 2_000n },
    ];
    // Trọng số a = 2.000, b = 2.000 ⇒ 1.000 chia 500/500; phần của a nằm ở đêm còn nợ a-1.
    expect(planReceiptAllocation(1_000n, charges, ['ROOM'])).toEqual([
      { chargeId: 'a-1', amount: 500n },
      { chargeId: 'b-0', amount: 500n },
    ]);
  });

  test('thứ tự nhóm: ROOM trước rồi PENALTY, không vượt nghĩa vụ từng dòng', () => {
    const charges: ReceiptCharge[] = [
      { id: 'p-1', kind: 'PENALTY', roomId: null, weight: 500n, outstanding: 500n },
      { id: 'r-1', kind: 'ROOM', roomId: 'room', weight: 1_000n, outstanding: 1_000n },
    ];
    expect(planReceiptAllocation(800n, charges, ['ROOM', 'PENALTY'])).toEqual([
      { chargeId: 'r-1', amount: 800n },
    ]);
    expect(planReceiptAllocation(1_300n, charges, ['ROOM', 'PENALTY'])).toEqual([
      { chargeId: 'r-1', amount: 1_000n },
      { chargeId: 'p-1', amount: 300n },
    ]);
  });

  test('khoản thu vượt nghĩa vụ: chỉ phân bổ tới nghĩa vụ còn lại, phần dư để trống cho hoàn', () => {
    const charges: ReceiptCharge[] = [
      { id: 'r-1', kind: 'ROOM', roomId: 'room', weight: 1_000n, outstanding: 1_000n },
    ];
    const lines = planReceiptAllocation(1_500n, charges, ['ROOM']);
    expect(lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(1_000n);
  });
});
