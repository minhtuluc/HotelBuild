import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { BookingLedger } from '../../src/modules/pay/ledger/service.js';
import { LedgerError } from '../../src/modules/pay/ledger/projection.js';
import { rows, booking, db, clock, actor, receipt, charge, request } from './fixture.js';
const ledger = new BookingLedger(clock);

test('read uses app_rw inherited privileges without writes; sync persists projection and audit in caller transaction', async () => {
  const b = await booking();
  const p = await receipt(b.id, 1000n),
    c = await charge(b.id, b.room, 2000n);
  await rows('INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,1000)', [
    p,
    c,
  ]);
  const before = (
    await rows('SELECT version,paid_amount,balance_due FROM bookings WHERE id=$1', [b.id])
  )[0];
  expect(await db.$transaction((tx) => ledger.read(tx, b.id))).toMatchObject({
    paidAmount: 1000n,
    balanceDue: 1000n,
  });
  expect(
    (await rows('SELECT version,paid_amount,balance_due FROM bookings WHERE id=$1', [b.id]))[0],
  ).toEqual(before);
  await db.$transaction((tx) => ledger.sync(tx, b.id, actor()));
  expect(
    (
      await rows('SELECT paid_amount,refunded_amount,balance_due FROM bookings WHERE id=$1', [b.id])
    )[0],
  ).toMatchObject({ paid_amount: '1000', refunded_amount: '0', balance_due: '1000' });
  const audit = await rows(
    "SELECT after_json FROM audit_logs WHERE entity_id=$1 AND action='LEDGER_RECONCILED'",
    [b.id],
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]!.after_json).toMatchObject({ paidAmount: '1000', balanceDue: '1000' });
  const version = (await rows('SELECT version FROM bookings WHERE id=$1', [b.id]))[0]!.version;
  await db.$transaction((tx) => ledger.sync(tx, b.id, actor()));
  expect((await rows('SELECT version FROM bookings WHERE id=$1', [b.id]))[0]!.version).toBe(
    version,
  );
});

test('reservation uses NET gross-minus-snapshotted-fee and exact replay creates one allocation/audit', async () => {
  const b = await booking(),
    p = await receipt(b.id, 1000n),
    r = await request(b.id, 900n, 100n);
  const legs = [{ paymentId: p, amount: 800n }];
  const result = await db.$transaction((tx) => ledger.reserve(tx, b.id, r, legs, actor()));
  expect(result).toMatchObject({
    paidAmount: 1000n,
    refundReserved: 800n,
    sources: [{ available: 200n }],
  });
  await db.$transaction((tx) => ledger.reserve(tx, b.id, r, legs, actor()));
  expect(
    await rows('SELECT amount FROM refund_allocations WHERE refund_request_id=$1', [r]),
  ).toEqual([{ amount: '800' }]);
  expect(
    await rows(
      "SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1 AND action='LEDGER_REFUND_RESERVED'",
      [b.id],
    ),
  ).toEqual([{ n: '1' }]);
  await expect(
    db.$transaction((tx) => ledger.reserve(tx, b.id, r, [{ paymentId: p, amount: 700n }], actor())),
  ).rejects.toBeInstanceOf(LedgerError);
});

test('two concurrent 80% requests under booking/receipt locks only commit one reservation', async () => {
  const b = await booking(),
    p = await receipt(b.id, 1000n);
  const requests = [await request(b.id, 800n), await request(b.id, 800n)];
  const results = await Promise.allSettled(
    requests.map((r) =>
      db.$transaction((tx) =>
        ledger.reserve(tx, b.id, r, [{ paymentId: p, amount: 800n }], actor()),
      ),
    ),
  );
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((x) => x.status === 'rejected');
  expect(rejected?.status).toBe('rejected');
  if (rejected?.status === 'rejected') expect(rejected.reason).toBeInstanceOf(LedgerError);
  expect(await rows('SELECT sum(amount)::text AS n FROM refund_allocations')).toEqual([
    { n: '800' },
  ]);
});

test('per-source cap and applied allocation cap reject before any reservation, audit or summary write', async () => {
  const b = await booking(),
    p = await receipt(b.id, 1000n),
    other = await receipt(b.id, 2000n),
    c = await charge(b.id, b.room, 600n);
  const r = await request(b.id, 1100n);
  const before = (await rows('SELECT version,paid_amount FROM bookings WHERE id=$1', [b.id]))[0];
  await expect(
    db.$transaction((tx) =>
      ledger.reserve(tx, b.id, r, [{ paymentId: p, amount: 1100n }], actor()),
    ),
  ).rejects.toBeInstanceOf(LedgerError);
  await rows('INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,600)', [
    p,
    c,
  ]);
  const r2 = await request(b.id, 800n);
  await expect(
    db.$transaction((tx) =>
      ledger.reserve(tx, b.id, r2, [{ paymentId: p, amount: 800n }], actor()),
    ),
  ).rejects.toBeInstanceOf(LedgerError);
  expect(await rows('SELECT count(*) AS n FROM refund_allocations')).toEqual([{ n: '0' }]);
  expect((await rows('SELECT version,paid_amount FROM bookings WHERE id=$1', [b.id]))[0]).toEqual(
    before,
  );
  const result = await db.$transaction((tx) =>
    ledger.reserve(tx, b.id, r2, [{ paymentId: other, amount: 800n }], actor()),
  );
  expect(result.refundReserved).toBe(800n);
});

test('released/voided room money can be reserved without paying remaining room and receipt never changes', async () => {
  const b = await booking(),
    p = await receipt(b.id, 1000n),
    c = await charge(b.id, b.room, 600n);
  await charge(b.id, b.room, 600n);
  await rows(
    "INSERT INTO payment_allocations(payment_id,charge_id,amount,released_amount,release_reason) VALUES($1,$2,600,600,'cancelled room')",
    [p, c],
  );
  await rows('UPDATE booking_charges SET voided_amount=amount WHERE id=$1', [c]);
  await rows('UPDATE bookings SET total_amount=600 WHERE id=$1', [b.id]);
  const before = await rows('SELECT * FROM payments WHERE id=$1', [p]);
  const r = await request(b.id, 600n);
  const result = await db.$transaction((tx) =>
    ledger.reserve(tx, b.id, r, [{ paymentId: p, amount: 600n }], actor()),
  );
  expect(result.balanceDue).toBe(600n);
  expect(result.refundReserved).toBe(600n);
  expect(await rows('SELECT * FROM payments WHERE id=$1', [p])).toEqual(before);
});

test('zero NET records no zero-value payout/allocation; mixed booking, pending receipt and duplicate legs fail', async () => {
  const b = await booking(),
    p = await receipt(b.id, 1000n),
    r = await request(b.id, 100n, 200n);
  expect(
    (await db.$transaction((tx) => ledger.reserve(tx, b.id, r, [], actor()))).refundReserved,
  ).toBe(0n);
  const other = await booking(),
    outsider = await receipt(other.id, 2000n),
    pending = await receipt(b.id, 2000n, 'DEPOSIT', 'PENDING');
  const r2 = await request(b.id, 100n),
    foreignRequest = await request(other.id, 100n);
  for (const [rid, legs] of [
    [r2, [{ paymentId: outsider, amount: 100n }]],
    [r2, [{ paymentId: pending, amount: 100n }]],
    [foreignRequest, [{ paymentId: p, amount: 100n }]],
    [
      r2,
      [
        { paymentId: p, amount: 50n },
        { paymentId: p, amount: 50n },
      ],
    ],
    [r2, [{ paymentId: p, amount: 0n }]],
  ] as const)
    await expect(
      db.$transaction((tx) => ledger.reserve(tx, b.id, rid, legs, actor())),
    ).rejects.toBeInstanceOf(LedgerError);
  expect(await rows('SELECT count(*) AS n FROM refund_allocations')).toEqual([{ n: '0' }]);
});

test('audit rejection and caller failure roll back allocation and summary writes together', async () => {
  const b = await booking(),
    p = await receipt(b.id, 1000n),
    r = await request(b.id, 800n);
  const before = (await rows('SELECT version,paid_amount FROM bookings WHERE id=$1', [b.id]))[0];
  await expect(
    db.$transaction((tx) =>
      ledger.reserve(tx, b.id, r, [{ paymentId: p, amount: 800n }], {
        ...actor(),
        id: randomUUID(),
      }),
    ),
  ).rejects.toBeDefined();
  await expect(
    db.$transaction(async (tx) => {
      await ledger.reserve(tx, b.id, r, [{ paymentId: p, amount: 800n }], actor());
      throw new Error('Synthetic caller failure');
    }),
  ).rejects.toThrow('Synthetic caller failure');
  expect(await rows('SELECT count(*) AS n FROM refund_allocations')).toEqual([{ n: '0' }]);
  expect((await rows('SELECT version,paid_amount FROM bookings WHERE id=$1', [b.id]))[0]).toEqual(
    before,
  );
  expect(await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1', [b.id])).toEqual([
    { n: '0' },
  ]);
});

test('missing booking fails safely and existing out-of-band overallocated obligations cannot publish a false balance', async () => {
  await expect(db.$transaction((tx) => ledger.read(tx, randomUUID()))).rejects.toBeInstanceOf(
    LedgerError,
  );
  const b = await booking(),
    p = await receipt(b.id, 1000n),
    c = await charge(b.id, b.room, 100n);
  await rows('INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,200)', [
    p,
    c,
  ]);
  await expect(db.$transaction((tx) => ledger.sync(tx, b.id, actor()))).rejects.toBeInstanceOf(
    LedgerError,
  );
  expect((await rows('SELECT paid_amount FROM bookings WHERE id=$1', [b.id]))[0]).toEqual({
    paid_amount: '0',
  });
});

test('partial successful payout on an APPROVED request transfers one leg from reserved to refunded exactly once', async () => {
  const b = await booking(),
    p1 = await receipt(b.id, 1000n),
    p2 = await receipt(b.id, 2000n),
    r = await request(b.id, 1500n);
  await db.$transaction((tx) =>
    ledger.reserve(
      tx,
      b.id,
      r,
      [
        { paymentId: p1, amount: 600n },
        { paymentId: p2, amount: 900n },
      ],
      actor(),
    ),
  );
  const approver = String((await rows("SELECT id FROM users WHERE username='h029-second'"))[0]!.id);
  await rows("UPDATE users SET role='MANAGER' WHERE id=$1", [approver]);
  await rows(
    `INSERT INTO refund_approvals(refund_request_id,request_version,approver_id,approver_role,decision,approved_amount,refund_fee,reason)
    SELECT id,version,$2,'MANAGER','APPROVED',1500,0,'Synthetic approval' FROM refund_requests WHERE id=$1`,
    [r, approver],
  );
  await rows(
    "UPDATE refund_requests SET status='APPROVED',approved_amount=1500,approved_by=$2,decided_at=clock_timestamp() WHERE id=$1",
    [r, approver],
  );
  const out1 = await receipt(b.id, -600n, 'REFUND', 'PENDING'),
    out2 = await receipt(b.id, -900n, 'REFUND', 'PENDING');
  await rows(
    'UPDATE refund_allocations SET refund_payment_id=$3 WHERE refund_request_id=$1 AND original_payment_id=$2',
    [r, p1, out1],
  );
  await rows(
    'UPDATE refund_allocations SET refund_payment_id=$3 WHERE refund_request_id=$1 AND original_payment_id=$2',
    [r, p2, out2],
  );
  await rows("UPDATE payments SET status='SUCCEEDED',paid_at=clock_timestamp() WHERE id=$1", [
    out1,
  ]);
  const partial = await db.$transaction((tx) => ledger.sync(tx, b.id, actor()));
  expect(partial).toMatchObject({ paidAmount: 3000n, refundedAmount: 600n, refundReserved: 900n });
  await db.$transaction((tx) => ledger.sync(tx, b.id, actor()));
  expect((await rows('SELECT refunded_amount FROM bookings WHERE id=$1', [b.id]))[0]).toEqual({
    refunded_amount: '600',
  });
  await rows("UPDATE payments SET status='SUCCEEDED',paid_at=clock_timestamp() WHERE id=$1", [
    out2,
  ]);
  await rows("UPDATE refund_requests SET status='PAID',paid_at=clock_timestamp() WHERE id=$1", [r]);
  expect(await db.$transaction((tx) => ledger.sync(tx, b.id, actor()))).toMatchObject({
    paidAmount: 3000n,
    refundedAmount: 1500n,
    refundReserved: 0n,
  });
});

test('cancelled PENDING request returns reservation and cannot be reserved again', async () => {
  const b = await booking(),
    p = await receipt(b.id, 1000n),
    r = await request(b.id, 800n);
  await db.$transaction((tx) =>
    ledger.reserve(tx, b.id, r, [{ paymentId: p, amount: 800n }], actor()),
  );
  await rows(
    "UPDATE refund_requests SET status='CANCELLED',cancelled_at=clock_timestamp() WHERE id=$1",
    [r],
  );
  expect(await db.$transaction((tx) => ledger.read(tx, b.id))).toMatchObject({
    refundReserved: 0n,
    sources: [{ available: 1000n }],
  });
  await expect(
    db.$transaction((tx) => ledger.reserve(tx, b.id, r, [{ paymentId: p, amount: 800n }], actor())),
  ).rejects.toBeInstanceOf(LedgerError);
});

test('passing a bare PrismaClient cannot silently run monetary locks in autocommit statements', async () => {
  const b = await booking(),
    p = await receipt(b.id, 1000n),
    r = await request(b.id, 800n);
  await expect(
    ledger.reserve(db, b.id, r, [{ paymentId: p, amount: 800n }], actor()),
  ).rejects.toBeInstanceOf(LedgerError);
  expect(await rows('SELECT count(*) AS n FROM refund_allocations')).toEqual([{ n: '0' }]);
});

test('REJECTED with approved amount zero releases historical rows without corrupting other source availability', async () => {
  const b = await booking(),
    p = await receipt(b.id, 1000n),
    r = await request(b.id, 800n);
  await db.$transaction((tx) =>
    ledger.reserve(tx, b.id, r, [{ paymentId: p, amount: 800n }], actor()),
  );
  const approver = String((await rows("SELECT id FROM users WHERE username='h029-second'"))[0]!.id);
  await rows("UPDATE users SET role='MANAGER' WHERE id=$1", [approver]);
  await rows(
    `INSERT INTO refund_approvals(refund_request_id,request_version,approver_id,approver_role,decision,approved_amount,refund_fee,reason)
    SELECT id,version,$2,'MANAGER','REJECTED',0,0,'Synthetic rejection' FROM refund_requests WHERE id=$1`,
    [r, approver],
  );
  await rows(
    "UPDATE refund_requests SET status='REJECTED',approved_amount=0,approved_by=$2,decided_at=clock_timestamp() WHERE id=$1",
    [r, approver],
  );
  expect(await db.$transaction((tx) => ledger.read(tx, b.id))).toMatchObject({
    refundReserved: 0n,
    sources: [{ available: 1000n }],
  });
  expect(
    await rows('SELECT amount FROM refund_allocations WHERE refund_request_id=$1', [r]),
  ).toEqual([{ amount: '800' }]);
});

test('active legacy booking with priced rooms but no charge ledger fails closed rather than publishing zero debt', async () => {
  const b = await booking();
  await rows('UPDATE bookings SET total_amount=2000,balance_due=2000 WHERE id=$1', [b.id]);
  await expect(db.$transaction((tx) => ledger.sync(tx, b.id, actor()))).rejects.toBeInstanceOf(
    LedgerError,
  );
  expect((await rows('SELECT balance_due FROM bookings WHERE id=$1', [b.id]))[0]).toEqual({
    balance_due: '2000',
  });
});

test('closed legacy booking cannot lose a declared unpaid penalty when ledger rows are missing', async () => {
  const b = await booking({ status: 'CANCELLED' });
  await rows('UPDATE bookings SET penalty_amount=100,balance_due=100 WHERE id=$1', [b.id]);
  await expect(db.$transaction((tx) => ledger.sync(tx, b.id, actor()))).rejects.toBeInstanceOf(
    LedgerError,
  );
  expect((await rows('SELECT balance_due FROM bookings WHERE id=$1', [b.id]))[0]).toEqual({
    balance_due: '100',
  });
});

test.each(['ROOM', 'PENALTY'])(
  'charge %s cannot reference a BookingRoom owned by another booking even when FKs and totals match',
  async (kind) => {
    const b = await booking(),
      other = await booking();
    const c = await charge(b.id, other.room, 500n, kind),
      p = await receipt(b.id, 100n);
    await rows('INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,100)', [
      p,
      c,
    ]);
    const before = await rows(
      'SELECT version,paid_amount,refunded_amount,balance_due FROM bookings WHERE id=$1',
      [b.id],
    );
    await expect(db.$transaction((tx) => ledger.read(tx, b.id))).rejects.toBeInstanceOf(
      LedgerError,
    );
    await expect(db.$transaction((tx) => ledger.sync(tx, b.id, actor()))).rejects.toBeInstanceOf(
      LedgerError,
    );
    expect(
      await rows(
        'SELECT version,paid_amount,refunded_amount,balance_due FROM bookings WHERE id=$1',
        [b.id],
      ),
    ).toEqual(before);
    expect(await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1', [b.id])).toEqual([
      { n: '0' },
    ]);
  },
);

test('committed non-room fee may have no BookingRoom and keeps its own allocated debt', async () => {
  const b = await booking(),
    p = await receipt(b.id, 30n, 'PENALTY');
  const c = String(
    (
      await rows(
        "INSERT INTO booking_charges(booking_id,kind,source_key,amount) VALUES($1,'PENALTY','standalone',100) RETURNING id",
        [b.id],
      )
    )[0]!.id,
  );
  await rows('UPDATE bookings SET penalty_amount=100 WHERE id=$1', [b.id]);
  await rows('INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,30)', [
    p,
    c,
  ]);
  expect(await db.$transaction((tx) => ledger.sync(tx, b.id, actor()))).toMatchObject({
    paidAmount: 30n,
    balanceDue: 70n,
  });
});
