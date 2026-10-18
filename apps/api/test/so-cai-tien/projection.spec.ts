import { expect, test } from 'vitest';
import { projectLedger, LedgerError } from '../../src/modules/pay/ledger/projection.js';
import type { LedgerFacts } from '../../src/modules/pay/ledger/types.js';

function facts(): LedgerFacts {
  return {
    booking: {
      id: 'b',
      property_id: 'property',
      status: 'CONFIRMED',
      paid_amount: 0n,
      refunded_amount: 0n,
      balance_due: 0n,
    },
    payments: [],
    charges: [],
    allocations: [],
    refunds: [],
    refundAllocations: [],
  };
}
function payment(id: string, amount: bigint, type = 'DEPOSIT', status = 'SUCCEEDED') {
  return { id, booking_id: 'b', amount, type, status };
}
function charge(id: string, amount: bigint, kind = 'ROOM', voided_amount = 0n) {
  return { id, booking_id: 'b', amount, kind, voided_amount };
}
function request(id: string, net_refund: bigint, status = 'PENDING') {
  return { id, booking_id: 'b', net_refund, status };
}
function refund(
  id: string,
  source: string,
  amount: bigint,
  requestId: string,
  payout: string | null = null,
) {
  return {
    id,
    original_payment_id: source,
    amount,
    refund_request_id: requestId,
    refund_payment_id: payout,
  };
}
function allocated(
  id: string,
  paymentId: string,
  chargeId: string,
  amount: bigint,
  released_amount = 0n,
) {
  return { id, payment_id: paymentId, charge_id: chargeId, amount, released_amount };
}

test('BR-PAY-02 counts only successful collections and never compensation or refund as income', () => {
  const f = facts();
  f.payments = [
    payment('d', 1000n),
    payment('b', 2000n, 'BALANCE'),
    payment('e', 100n, 'EXTRA_SERVICE'),
    payment('p', 200n, 'PENALTY'),
    payment('s', 300n, 'RESCHEDULE_FEE'),
    payment('c', 500n, 'COMPENSATION'),
    payment('waiting', 9000n, 'DEPOSIT', 'PENDING'),
    payment('failed', 8000n, 'BALANCE', 'FAILED'),
  ];
  expect(projectLedger(f)).toMatchObject({
    paidAmount: 3600n,
    refundedAmount: 0n,
    refundReserved: 0n,
    balanceDue: 0n,
  });
  // Thu theo **từng loại** (BR-PAY-02): người tiêu thụ đúng nghĩa vụ lấy đúng loại, không bù trừ toàn cục.
  expect(projectLedger(f).paidByType).toEqual({
    DEPOSIT: 1000n,
    BALANCE: 2000n,
    EXTRA_SERVICE: 100n,
    PENALTY: 200n,
    RESCHEDULE_FEE: 300n,
  });
});

test('room debts do not net across rooms and released funds cannot pay retained room twice', () => {
  const f = facts();
  f.payments = [payment('d', 1000n)];
  f.charges = [charge('room1', 600n), charge('room2', 600n), charge('fee', 100n, 'PENALTY')];
  f.allocations = [allocated('a', 'd', 'room1', 600n, 200n), allocated('f', 'd', 'fee', 100n)];
  expect(projectLedger(f)).toMatchObject({
    balanceDue: 800n,
    sources: [{ collected: 1000n, applied: 500n, available: 500n }],
  });
  expect(projectLedger(f).charges).toEqual([
    { id: 'room1', outstanding: 200n },
    { id: 'room2', outstanding: 600n },
    { id: 'fee', outstanding: 0n },
  ]);
  f.charges[0] = charge('room1', 600n, 'ROOM', 600n);
  f.allocations[0] = allocated('a', 'd', 'room1', 600n, 600n);
  expect(projectLedger(f).balanceDue).toBe(600n);
});

test('pending or failed collections do not pay a charge until receipt succeeds', () => {
  const f = facts();
  f.payments = [payment('d', 600n, 'DEPOSIT', 'PENDING')];
  f.charges = [charge('r', 600n)];
  f.allocations = [allocated('a', 'd', 'r', 600n)];
  expect(projectLedger(f).balanceDue).toBe(600n);
  f.payments[0] = payment('d', 600n);
  expect(projectLedger(f).balanceDue).toBe(0n);
});

test.each(['CANCELLED', 'NO_SHOW'])(
  '%s excludes room debt but retains committed penalty and fee minus their collections',
  (status) => {
    const f = facts();
    f.booking.status = status;
    f.payments = [payment('p', 30n, 'PENALTY')];
    f.charges = [
      charge('room', 1000n),
      charge('penalty', 100n, 'PENALTY'),
      charge('fee', 20n, 'RESCHEDULE_FEE'),
    ];
    f.allocations = [allocated('a', 'p', 'penalty', 30n)];
    expect(projectLedger(f).balanceDue).toBe(90n);
  },
);

test('EXPIRED has no penalty or room debt, while collection history remains intact', () => {
  const f = facts();
  f.booking.status = 'EXPIRED';
  f.payments = [payment('d', 1234n)];
  f.charges = [charge('room', 2000n), charge('penalty', 100n, 'PENALTY')];
  expect(projectLedger(f)).toMatchObject({ balanceDue: 0n, paidAmount: 1234n });
});

test('partial APPROVED payout counts a successful leg once and retains unknown legs as NET reservations', () => {
  const f = facts();
  f.payments = [
    payment('p1', 1000n),
    payment('p2', 2000n),
    payment('out1', -600n, 'REFUND'),
    payment('out2', -900n, 'REFUND', 'PENDING'),
  ];
  f.refunds = [request('r', 1500n, 'APPROVED')];
  f.refundAllocations = [
    refund('a1', 'p1', 600n, 'r', 'out1'),
    refund('a2', 'p2', 900n, 'r', 'out2'),
  ];
  const p = projectLedger(f);
  expect(p).toMatchObject({ paidAmount: 3000n, refundedAmount: 600n, refundReserved: 900n });
  expect(p.sources).toEqual([
    {
      paymentId: 'p1',
      collected: 1000n,
      applied: 0n,
      refunded: 600n,
      reserved: 0n,
      available: 400n,
    },
    {
      paymentId: 'p2',
      collected: 2000n,
      applied: 0n,
      refunded: 0n,
      reserved: 900n,
      available: 1100n,
    },
  ]);
  f.payments[3] = payment('out2', -900n, 'REFUND');
  f.refunds[0] = request('r', 1500n, 'PAID');
  expect(projectLedger(f)).toMatchObject({
    paidAmount: 3000n,
    refundedAmount: 1500n,
    refundReserved: 0n,
  });
});

test.each(['REJECTED', 'CANCELLED'])(
  '%s returns its reservation without touching original collection',
  (status) => {
    const f = facts();
    f.payments = [payment('p', 1000n)];
    f.refunds = [request('r', 800n, status)];
    f.refundAllocations = [refund('a', 'p', 800n, 'r')];
    expect(projectLedger(f)).toMatchObject({
      paidAmount: 1000n,
      refundReserved: 0n,
      sources: [{ available: 1000n }],
    });
  },
);

test('refund reservation cannot reuse applied room funds even below total collected cap', () => {
  const f = facts();
  f.payments = [payment('p', 1000n)];
  f.charges = [charge('c', 600n)];
  f.allocations = [allocated('ap', 'p', 'c', 600n)];
  f.refunds = [request('r', 800n)];
  f.refundAllocations = [refund('a', 'p', 800n, 'r')];
  expect(() => projectLedger(f)).toThrow(LedgerError);
});

test('per-source cap rejects 1100 refund on a 1000 source even when another source has 2000', () => {
  const f = facts();
  f.payments = [payment('p', 1000n), payment('other', 2000n)];
  f.refunds = [request('r', 1100n)];
  f.refundAllocations = [refund('a', 'p', 1100n, 'r')];
  expect(() => projectLedger(f)).toThrow(LedgerError);
});

test('inconsistent sources, duplicated identities, unlinked success, incorrect payout sign and overpaid charges fail closed', () => {
  const bad: LedgerFacts[] = [];
  let f = facts();
  f.payments = [payment('p', 100n), payment('p', 100n)];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 100n)];
  f.payments[0]!.booking_id = 'elsewhere';
  bad.push(f);
  f = facts();
  f.payments = [payment('out', -100n, 'REFUND')];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 1000n), payment('out', 100n, 'REFUND')];
  bad.push(f);
  f = facts();
  f.charges = [charge('c', 100n, 'ROOM', 101n)];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 1000n)];
  f.charges = [charge('c', 100n)];
  f.allocations = [allocated('a', 'p', 'c', 101n)];
  bad.push(f);
  f = facts();
  f.allocations = [allocated('a', 'missing', 'missing', 1n)];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 1000n)];
  f.refunds = [request('r', 100n)];
  f.refundAllocations = [refund('a', 'p', 101n, 'r')];
  bad.push(f);
  for (const value of bad) expect(() => projectLedger(value)).toThrow(LedgerError);
});

test('bigint money remains exact beyond JavaScript safe integer range and inputs are immutable', () => {
  const f = facts();
  f.payments = [payment('p', 9007199254740993n)];
  f.charges = [charge('c', 9007199254740995n)];
  f.allocations = [allocated('a', 'p', 'c', 9007199254740993n)];
  const before = structuredClone(f);
  expect(projectLedger(f).balanceDue).toBe(2n);
  expect(f).toEqual(before);
});

test('fixed-seed 1000 traces conserve collected funds under applied, reserved and refunded partitions', () => {
  let seed = 93002;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let trace = 0; trace < 1000; trace++) {
    const f = facts();
    const collected = BigInt(1 + (random() % 1000000));
    const applied = BigInt(random()) % (collected + 1n);
    const paidOut = BigInt(random()) % (collected - applied + 1n);
    const reserved = BigInt(random()) % (collected - applied - paidOut + 1n);
    f.payments = [payment('p', collected)];
    f.charges = [charge('room', applied + 15n)];
    if (applied > 0n) f.allocations = [allocated('a', 'p', 'room', applied)];
    if (paidOut > 0n) {
      f.payments.push(payment('out', -paidOut, 'REFUND'));
      f.refunds.push(request('r1', paidOut, 'PAID'));
      f.refundAllocations.push(refund('r1a', 'p', paidOut, 'r1', 'out'));
    }
    if (reserved > 0n) {
      f.refunds.push(request('r2', reserved));
      f.refundAllocations.push(refund('r2a', 'p', reserved, 'r2'));
    }
    const p = projectLedger(f);
    expect(p.balanceDue).toBe(15n);
    expect(p.paidAmount).toBe(collected);
    expect(p.refundedAmount).toBe(paidOut);
    expect(p.refundReserved).toBe(reserved);
    expect(p.sources[0]!.available).toBe(collected - applied - paidOut - reserved);
    f.refunds.push(request('overflow', collected + 1n));
    f.refundAllocations.push(refund('overflow', 'p', collected + 1n, 'overflow'));
    expect(() => projectLedger(f)).toThrow(LedgerError);
  }
});

test('invalid payout linkage, duplicate obligation pairs and incomplete PAID claims fail closed', () => {
  const bad: LedgerFacts[] = [];
  let f = facts();
  f.payments = [payment('p', 1000n), payment('out', -100n, 'REFUND')];
  f.refunds = [request('r', 100n, 'PENDING')];
  f.refundAllocations = [refund('a', 'p', 100n, 'r', 'out')];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 1000n)];
  f.refunds = [request('r', 100n, 'PAID')];
  f.refundAllocations = [refund('a', 'p', 100n, 'r')];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 1000n)];
  f.refunds = [request('r', 100n, 'PAID')];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 1000n), payment('out', -101n, 'REFUND')];
  f.refunds = [request('r', 100n, 'APPROVED')];
  f.refundAllocations = [refund('a', 'p', 100n, 'r', 'out')];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 1000n)];
  f.refunds = [request('r', 100n)];
  f.refundAllocations = [refund('a', 'p', 50n, 'r'), refund('b', 'p', 50n, 'r')];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 1000n)];
  f.charges = [charge('c', 1000n)];
  f.allocations = [allocated('a', 'p', 'c', 50n), allocated('b', 'p', 'c', 50n)];
  bad.push(f);
  f = facts();
  f.payments = [payment('p', 1000n)];
  f.charges = [charge('c', 1000n)];
  f.allocations = [allocated('a', 'p', 'c', 50n, 51n)];
  bad.push(f);
  f = facts();
  f.payments = [payment('c', 1000n, 'COMPENSATION')];
  f.charges = [charge('c', 1000n)];
  f.allocations = [allocated('a', 'c', 'c', 50n)];
  bad.push(f);
  f = facts();
  f.refunds = [{ ...request('r', 100n), net_refund: null }];
  bad.push(f);
  for (const value of bad) expect(() => projectLedger(value)).toThrow(LedgerError);
});

test('fixed-seed operation sequences never re-use a receipt after reserve or completed refund', () => {
  let seed = 931234;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed;
  };
  for (let trace = 0; trace < 100; trace++) {
    const f = facts();
    let collected = 0n,
      reserved = 0n,
      returned = 0n;
    for (let step = 0; step < 30; step++) {
      const op = next() % 3;
      if (op === 0 || collected === 0n) {
        const amount = BigInt(1 + (next() % 10000));
        f.payments.push(payment('p' + step, amount));
        collected += amount;
      } else if (op === 1) {
        const source = f.payments.find(
          (p) =>
            p.type === 'DEPOSIT' &&
            f.refundAllocations.every((a) => a.original_payment_id !== p.id),
        );
        if (source) {
          const amount = source.amount;
          f.refunds.push(request('r' + step, amount));
          f.refundAllocations.push(refund('a' + step, source.id, amount, 'r' + step));
          reserved += amount;
        }
      } else {
        const r = f.refunds.find((r) => r.status === 'PENDING');
        if (r) {
          const a = f.refundAllocations.find((a) => a.refund_request_id === r.id)!;
          a.refund_payment_id = 'out' + step;
          f.payments.push(payment('out' + step, -a.amount, 'REFUND'));
          r.status = 'PAID';
          reserved -= a.amount;
          returned += a.amount;
        }
      }
      const projected = projectLedger(f);
      expect(projected.paidAmount).toBe(collected);
      expect(projected.refundedAmount).toBe(returned);
      expect(projected.refundReserved).toBe(reserved);
      expect(projected.sources.reduce((sum, s) => sum + s.available, 0n)).toBe(
        collected - reserved - returned,
      );
      expect(returned + reserved).toBeLessThanOrEqual(collected);
    }
  }
});

test('rejected decision may reduce NET to zero while historical released reservation rows remain', () => {
  const f = facts();
  f.payments = [payment('p', 1000n)];
  f.refunds = [request('r', 0n, 'REJECTED')];
  f.refundAllocations = [refund('a', 'p', 800n, 'r')];
  expect(projectLedger(f)).toMatchObject({
    paidAmount: 1000n,
    refundReserved: 0n,
    sources: [{ available: 1000n }],
  });
});
