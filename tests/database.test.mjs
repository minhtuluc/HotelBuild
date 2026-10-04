import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { read, sqlBlocks } from '../scripts/lib/docs.mjs';
import { openDatabase, realPostgres, fixture, insert, rejectsSQL } from './helpers/database.mjs';

test('documented §3 DDL and business constraints', async (t) => {
  const db = await openDatabase();
  t.after(() => db.close());
  const source = await read('docs/04-thiet-ke/csdl.md');
  const q1 = sqlBlocks(source, /^Q1\s/, 3)[0].sql;
  const q2 = sqlBlocks(source, /^Q2\s/, 3)[0].sql;
  const run = async (name, body) => t.test(name, async () => {
    await db.exec('BEGIN');
    try { await body(await fixture(db)); }
    finally { await db.exec('ROLLBACK'); }
  });
  const availability = async (channel = 'WEB', type = 'STD') => (await db.query(q1, ['2030-01-01', '2030-01-03', channel])).rows.filter((row) => row.room_type === type);
  const expectAvailability = async (expected, channel, type) => {
    const rows = await availability(channel, type);
    assert.equal(rows.length, 2, 'one row per stay night');
    assert.deepEqual(rows.map((r) => [Number(r.available_general), Number(r.available_channel)]), expected);
  };
  const block = (f, overrides = {}) => insert(db, 'room_blocks', { room_id: f.room.id, start_date: '2030-01-01', end_date: '2030-01-03', reason: 'MAINTENANCE', created_by: f.user.id, ...overrides });

  await t.test('DDL smoke: extensions, new physical tables, generated columns and exclusion constraint', async () => {
    const extensions = (await db.query('SELECT extname FROM pg_extension')).rows.map((r) => r.extname);
    assert.ok(extensions.includes('btree_gist'));
    assert.ok(extensions.includes('pgcrypto'));
    for (const table of ['bookings', 'room_assignments', 'price_snapshots', 'booking_charges', 'payment_allocations', 'refund_approvals', 'refund_allocations', 'idempotency_keys', 'webhook_inbox', 'event_deliveries']) {
      assert.equal((await db.query('SELECT to_regclass($1) IS NOT NULL AS present', [table])).rows[0].present, true, table);
    }
    assert.ok((await db.query("SELECT conname FROM pg_constraint WHERE contype = 'x' AND conrelid = 'room_assignments'::regclass")).rows.length >= 2);
  });

  await run('HB-010: principal/surface, hashed tokens, counters and PIN/reset expiry enforced by current DDL', async (f) => {
    const start = '2030-01-01T00:00:00Z';
    const session = await insert(db, 'auth_sessions', { principal_type: 'USER', user_id: f.user.id, surface: 'OPS_WEB', family_id: f.user.id, token_hash: 'session-fixture-hash', created_at: start, expires_at: '2030-01-08' });
    for (const [field, value] of [['principal_type', 'INVALID'], ['user_id', null], ['guest_id', f.guest.id], ['surface', 'GUEST_WEB'], ['surface', 'INVALID'], ['expires_at', start]]) {
      await rejectsSQL(db, `UPDATE auth_sessions SET ${field}=$1 WHERE id=$2`, [value, session.id], '23514');
    }
    for (const surface of ['GUEST_WEB', 'GUEST_ANDROID']) await insert(db, 'auth_sessions', { principal_type: 'GUEST', guest_id: f.guest.id, surface, family_id: f.guest.id, token_hash: `guest-${surface}-hash`, created_at: start, expires_at: '2030-01-08' });
    await rejectsSQL(db, 'UPDATE auth_sessions SET token_hash=$1 WHERE id<>$2', [session.token_hash, session.id], '23505');
    await insert(db, 'guest_credentials', { guest_id: f.guest.id, password_hash: 'fixture-password-hash' });
    await insert(db, 'user_pins', { user_id: f.user.id, pin_hash: 'fixture-pin-hash' });
    await rejectsSQL(db, 'UPDATE guest_credentials SET failed_login_count=-1 WHERE guest_id=$1', [f.guest.id], '23514');
    await rejectsSQL(db, 'UPDATE user_pins SET failed_count=-1 WHERE user_id=$1', [f.user.id], '23514');
    const grant = await insert(db, 'pin_grants', { user_id: f.user.id, session_id: session.id, purpose: 'PAYMENT', booking_id: (await f.booking()).id, token_hash: 'pin-fixture-hash', created_at: start, expires_at: '2030-01-01T00:05:00Z' });
    const reset = await insert(db, 'guest_password_resets', { guest_id: f.guest.id, token_hash: 'reset-fixture-hash', created_at: start, expires_at: '2030-01-01T00:30:00Z' });
    for (const [table, row, excess] of [['pin_grants', grant, '2030-01-01T00:05:00.001Z'], ['guest_password_resets', reset, '2030-01-01T00:30:00.001Z']]) {
      for (const expiry of [start, excess]) await rejectsSQL(db, `UPDATE ${table} SET expires_at=$1 WHERE id=$2`, [expiry, row.id], '23514');
    }
    await rejectsSQL(db, 'INSERT INTO pin_grants(user_id,session_id,purpose,token_hash,created_at,expires_at) SELECT user_id,session_id,purpose,token_hash,created_at,expires_at FROM pin_grants', [], '23505');
    await rejectsSQL(db, 'INSERT INTO guest_password_resets(guest_id,token_hash,created_at,expires_at) SELECT guest_id,token_hash,created_at,expires_at FROM guest_password_resets', [], '23505');
    await rejectsSQL(db, 'UPDATE pin_grants SET user_id=$1 WHERE id=$2', [f.otherUser.id, grant.id], '23503');
  });

  await run('BR-INV-03: same unit overlaps rejected, adjacent nights accepted, released unit reusable', async (f) => {
    const a = await f.assignment(await f.bookingRoom(await f.booking()));
    const br = await f.bookingRoom(await f.booking());
    await rejectsSQL(db, "INSERT INTO room_assignments (booking_room_id, room_id, start_date, end_date) VALUES ($1,$2,'2030-01-02','2030-01-04')", [br.id, f.room.id], '23P01');
    await f.assignment(br, { start_date: '2030-01-03', end_date: '2030-01-04' });
    await db.query('UPDATE room_assignments SET released_at = now() WHERE id=$1', [a.id]);
    await f.assignment(await f.bookingRoom(await f.booking()));
  });

  await run('BR-INV-03 / BR-PROP-04: distinct dorm beds coexist; duplicate beds and whole-dorm claims rejected', async (f) => {
    const br = await f.bookingRoom(await f.booking({ room_type_id: f.dorm.id }));
    await f.assignment(br, { room_id: f.dormRoom.id, bed_no: 1 });
    await f.assignment(await f.bookingRoom(await f.booking({ room_type_id: f.dorm.id })), { room_id: f.dormRoom.id, bed_no: 2 });
    const third = await f.bookingRoom(await f.booking({ room_type_id: f.dorm.id }));
    await rejectsSQL(db, "INSERT INTO room_assignments (booking_room_id,room_id,bed_no,start_date,end_date) VALUES ($1,$2,1,'2030-01-01','2030-01-03')", [third.id, f.dormRoom.id], '23P01');
    await rejectsSQL(db, "INSERT INTO room_assignments (booking_room_id,room_id,bed_no,start_date,end_date) VALUES ($1,$2,0,'2030-01-01','2030-01-03')", [third.id, f.dormRoom.id], '23514');
    await db.exec('UPDATE room_assignments SET released_at=now()');
    await rejectsSQL(db, "INSERT INTO room_assignments (booking_room_id,room_id,bed_no,start_date,end_date) VALUES ($1,$2,0,'2030-01-01','2030-01-03')", [third.id, f.dormRoom.id], '23514');
    await f.assignment(third, { room_id: f.dormRoom.id, bed_no: 1 });
  });

  await run('BR-PROP-04: reject non-shared bed numbers, out-of-range beds and shrinking occupied capacity', async (f) => {
    const br = await f.bookingRoom(await f.booking());
    const sql = "INSERT INTO room_assignments (booking_room_id,room_id,bed_no,start_date,end_date) VALUES ($1,$2,$3,'2030-01-01','2030-01-03')";
    await rejectsSQL(db, sql, [br.id, f.room.id, 1], '23514');
    await rejectsSQL(db, sql, [br.id, f.dormRoom.id, 7], '23514');
    await f.assignment(br, { room_id: f.dormRoom.id, bed_no: 6 });
    await rejectsSQL(db, 'UPDATE rooms SET bed_count=5 WHERE id=$1', [f.dormRoom.id], '23514');
  });

  await run('BR-INV-03: one BookingRoom cannot occupy two places on the same night', async (f) => {
    const br = await f.bookingRoom(await f.booking());
    await f.assignment(br);
    await rejectsSQL(db, "INSERT INTO room_assignments (booking_room_id,room_id,start_date,end_date) VALUES ($1,$2,'2030-01-01','2030-01-03')", [br.id, f.room2.id], '23P01');
  });

  await run('BR-INV-06: block then assignment, assignment then block, manager exception and release', async (f) => {
    await block(f);
    const br = await f.bookingRoom(await f.booking());
    await rejectsSQL(db, "INSERT INTO room_assignments (booking_room_id,room_id,start_date,end_date) VALUES ($1,$2,'2030-01-01','2030-01-03')", [br.id, f.room.id], '23P01');
    const a = await f.assignment(br, { room_id: f.room2.id });
    await rejectsSQL(db, "INSERT INTO room_blocks (room_id,start_date,end_date,reason,created_by) VALUES ($1,'2030-01-01','2030-01-03','MAINTENANCE',$2)", [f.room2.id, f.user.id], '23P01');
    await db.exec("SET LOCAL app.actor_role='MANAGER'");
    await block(f, { room_id: f.room2.id });
    await db.exec("SET LOCAL app.actor_role='FRONT_DESK'");
    await db.query('UPDATE room_assignments SET released_at=now() WHERE id=$1', [a.id]);
  });

  await run('BR-INV-05 / BR-CHAN-08: quota capped by supply; inbound OTA used may exceed quota', async (f) => {
    await insert(db, 'channel_allotments', { channel_id: f.ota.id, room_type_id: f.dorm.id, date: '2030-01-01', allotment: 6 });
    await rejectsSQL(db, "UPDATE channel_allotments SET allotment=7", [], '23514');
    await db.exec('UPDATE channel_allotments SET used=7');
    assert.equal(Number((await db.query('SELECT used FROM channel_allotments')).rows[0].used), 7);
    await rejectsSQL(db, 'UPDATE channel_allotments SET used=-1', [], '23514');
    await rejectsSQL(db, "INSERT INTO channel_allotments (channel_id,room_type_id,date,allotment) VALUES ($1,$2,'2030-01-01',3)", [f.ota.id, f.type.id], '23514');
  });

  await run('Q1 baseline: standard rooms count once despite two beds; dorm counts six; checkout excluded', async () => {
    await expectAvailability([[2, 2], [2, 2]]);
    await expectAvailability([[6, 6], [6, 6]], 'WEB', 'DOR');
  });

  await run('Q1 blocks form a union, never double-subtract; inactive rooms excluded', async (f) => {
    await block(f);
    await block(f, { reason: 'RENOVATION' });
    await expectAvailability([[1, 1], [1, 1]]);
    await db.query("UPDATE rooms SET status='MAINTENANCE' WHERE id=$1", [f.room.id]);
    await expectAvailability([[1, 1], [1, 1]]);
  });

  await run('Q1 same-channel holds and PENDING_PAYMENT count, expired holds do not', async (f) => {
    const held = await f.booking({ status: 'HELD', hold_expires_at: '2099-01-01' });
    await f.bookingRoom(held);
    await f.bookingRoom(await f.booking({ status: 'PENDING_PAYMENT', hold_expires_at: '2099-01-01' }));
    await f.bookingRoom(await f.booking({ status: 'HELD', hold_expires_at: '2000-01-01' }));
    await expectAvailability([[0, 0], [0, 0]]);
  });

  await run('Q1 partially assigned multi-unit booking subtracts outstanding units on each night', async (f) => {
    const b = await f.booking({ status: 'CONFIRMED', room_count: 2 });
    const first = await f.bookingRoom(b);
    await f.bookingRoom(b);
    await f.assignment(first, { end_date: '2030-01-02' });
    await expectAvailability([[0, 0], [0, 0]]);
  });

  await run('Q1 confirmed oversold commitments stay negative; cancelled unit no longer consumes capacity', async (f) => {
    const b = await f.booking({ status: 'CONFIRMED', room_count: 3, oversold: true });
    await f.bookingRoom(b); await f.bookingRoom(b);
    const third = await f.bookingRoom(b);
    await expectAvailability([[-1, 0], [-1, 0]]);
    await db.query("UPDATE booking_rooms SET status='CANCELLED', cancelled_at=now() WHERE id=$1", [third.id]);
    await expectAvailability([[0, 0], [0, 0]]);
  });

  await run('Q1 OTA defaults, real demand instead of cached used, and per-night closure', async (f) => {
    await expectAvailability([[2, 1], [2, 1]], 'OTA_BOOKING');
    await expectAvailability([[6, 4], [6, 4]], 'OTA_BOOKING', 'DOR');
    await insert(db, 'channel_allotments', { channel_id: f.ota.id, room_type_id: f.type.id, date: '2030-01-01', allotment: 2, used: 1 });
    await expectAvailability([[2, 2], [2, 1]], 'OTA_BOOKING');
    await expectAvailability([[2, 2], [2, 2]], 'WEB');
    await f.bookingRoom(await f.booking({ channel_id: f.ota.id, status: 'HELD', hold_expires_at: '2099-01-01' }));
    await db.exec('UPDATE channel_allotments SET used=0');
    await expectAvailability([[1, 1], [1, 0]], 'OTA_BOOKING');
    await expectAvailability([[1, 1], [1, 1]], 'WEB');
    await db.exec('UPDATE channel_allotments SET is_closed=true, closed_at=now()');
    await expectAvailability([[1, 0], [1, 0]], 'OTA_BOOKING');
  });

  await run('Q1 block removes supply while booking remains demand; physical union counts overlap once', async (f) => {
    const br = await f.bookingRoom(await f.booking({ status: 'CONFIRMED' }));
    await f.assignment(br);
    await db.exec("SET LOCAL app.actor_role='MANAGER'");
    await block(f);
    await expectAvailability([[0, 0], [0, 0]]);
    assert.deepEqual((await availability()).map((r) => Number(r.physical_available)), [1, 1]);
  });

  await run('Q1 OTA default minimum and zero supply; AGENCY requires explicit quota; inactive channel closes', async (f) => {
    const agency = await insert(db, 'channels', { code: 'AGENCY', name: 'Agency', multiplier: 1 });
    await expectAvailability([[2, 0], [2, 0]], 'AGENCY');
    await insert(db, 'channel_allotments', { channel_id: agency.id, room_type_id: f.type.id, date: '2030-01-01', allotment: 1 });
    await expectAvailability([[2, 1], [2, 0]], 'AGENCY');
    await db.query("UPDATE rooms SET status='MAINTENANCE' WHERE id=$1", [f.room.id]);
    await expectAvailability([[1, 1], [1, 1]], 'OTA_BOOKING');
    await db.query("UPDATE rooms SET status='MAINTENANCE' WHERE id=$1", [f.room2.id]);
    await expectAvailability([[0, 0], [0, 0]], 'OTA_BOOKING');
    await db.query("UPDATE channels SET status='INACTIVE' WHERE id=$1", [f.ota.id]);
    await expectAvailability([[6, 0], [6, 0]], 'OTA_BOOKING', 'DOR');
  });

  await run('Q1 inbound OTA oversell retained as demand even when quota closed', async (f) => {
    await insert(db, 'channel_allotments', { channel_id: f.ota.id, room_type_id: f.type.id, date: '2030-01-01', allotment: 1, used: 3, is_closed: true, closed_at: '2030-01-01' });
    const b = await f.booking({ channel_id: f.ota.id, status: 'CONFIRMED', room_count: 3, oversold: true });
    for (let i = 0; i < 3; i++) await f.bookingRoom(b);
    await expectAvailability([[-1, 0], [-1, 0]], 'OTA_BOOKING');
    await expectAvailability([[-1, 0], [-1, 0]], 'WEB');
    assert.deepEqual((await availability()).map((r) => Number(r.physical_available)), [2, 2]);
  });

  await run('Q2 separates bed conflict, maintenance block and half-open adjacency', async (f) => {
    await f.assignment(await f.bookingRoom(await f.booking()), { room_id: f.dormRoom.id, bed_no: 1 });
    const query = async (bed, from = '2030-01-01', to = '2030-01-03') => (await db.query(q2, [f.dormRoom.id, bed, from, to])).rows[0];
    assert.equal((await query(1)).free_of_assignment, false);
    assert.equal((await query(0)).free_of_assignment, false);
    assert.equal((await query(2)).free_of_assignment, true);
    assert.equal((await query(1, '2030-01-03', '2030-01-04')).free_of_assignment, true);
    await block(f, { room_id: f.dormRoom.id, start_date: '2030-01-03', end_date: '2030-01-04' });
    assert.equal((await query(2, '2030-01-03', '2030-01-04')).free_of_block, false);
  });

  await run('Booking generated nights, writable nonnegative balance projection and required hold deadline', async (f) => {
    const b = await f.booking({ total_amount: 1300000, paid_amount: 500000, balance_due: 800000 });
    assert.equal(Number(b.nights), 2);
    assert.equal(Number(b.balance_due), 800000);
    const columns = (await db.query("SELECT column_name, is_generated FROM information_schema.columns WHERE table_name='bookings' AND column_name IN ('nights','balance_due')")).rows;
    assert.equal(columns.find((c) => c.column_name === 'nights').is_generated, 'ALWAYS');
    assert.equal(columns.find((c) => c.column_name === 'balance_due').is_generated, 'NEVER');
    // The application transaction recomputes this projection from charge allocations.
    await db.query("UPDATE bookings SET status='CANCELLED', cancelled_at=now(), penalty_amount=100000, balance_due=100000 WHERE id=$1", [b.id]);
    assert.equal(Number((await db.query('SELECT balance_due FROM bookings WHERE id=$1', [b.id])).rows[0].balance_due), 100000);
    await rejectsSQL(db, "UPDATE bookings SET status='PENDING_PAYMENT', hold_expires_at=NULL WHERE id=$1", [b.id], '23514');
    await rejectsSQL(db, 'UPDATE bookings SET check_out=check_in WHERE id=$1', [b.id], '23514');
    await rejectsSQL(db, 'UPDATE bookings SET refunded_amount=paid_amount+1 WHERE id=$1', [b.id], '23514');
    await rejectsSQL(db, 'UPDATE bookings SET balance_due=-1 WHERE id=$1', [b.id], '23514');
  });

  await run('BR-RATE-16: snapshot gross/commission/policy persist, revision key unique and payload immutable', async (f) => {
    const b = await f.booking();
    const snapshot = await insert(db, 'price_snapshots', { booking_id: b.id, seq: 1, quote_id: '00000000-0000-4000-8000-000000000001', quote_fingerprint: 'test-quote-fingerprint', payload_json: { nights: [{ nightlyPrice: 650000 }] }, gross_amount: 650000, commission_amount: 0, policy_snapshot_json: { code: 'FLEX7' }, engine_version: 'docs-test' });
    await rejectsSQL(db, "UPDATE price_snapshots SET payload_json='{}' WHERE id=$1", [snapshot.id], '42501');
    await rejectsSQL(db, 'DELETE FROM price_snapshots WHERE id=$1', [snapshot.id], '42501');
    await rejectsSQL(db, "INSERT INTO price_snapshots (booking_id,seq,kind,payload_json,gross_amount,commission_amount,policy_snapshot_json,engine_version) VALUES ($1,1,'RESCHEDULE','{}',650000,0,'{}','test')", [b.id], '23505');
    await rejectsSQL(db, "INSERT INTO price_snapshots (booking_id,seq,kind,payload_json,gross_amount,commission_amount,policy_snapshot_json,engine_version) VALUES ($1,2,'RESCHEDULE','{}',650000,650001,'{}','test')", [b.id], '23514');
    await insert(db, 'price_snapshots', { booking_id: b.id, seq: 2, kind: 'RESCHEDULE', payload_json: {}, gross_amount: 700000, commission_amount: 0, policy_snapshot_json: {}, engine_version: 'docs-test' });
  });

  await run('Snapshot acceptance: quote optional for OTA, explicit quote cannot be reused, one ORIGINAL per booking', async (f) => {
    const one = await f.booking({ channel_id: f.ota.id });
    const two = await f.booking();
    const values = { seq: 1, payload_json: {}, gross_amount: 650000, commission_amount: 0, policy_snapshot_json: {}, engine_version: 'docs-test' };
    await insert(db, 'price_snapshots', { ...values, booking_id: one.id });
    const snapshot = await insert(db, 'price_snapshots', { ...values, booking_id: two.id, quote_id: '00000000-0000-4000-8000-000000000002', quote_fingerprint: 'accepted-quote' });
    const three = await f.booking();
    await rejectsSQL(db, 'INSERT INTO price_snapshots (booking_id,seq,payload_json,gross_amount,commission_amount,policy_snapshot_json,engine_version,quote_id,quote_fingerprint) SELECT $2,1,payload_json,gross_amount,commission_amount,policy_snapshot_json,engine_version,quote_id,quote_fingerprint FROM price_snapshots WHERE id=$1', [snapshot.id, three.id], '23505');
    await rejectsSQL(db, "INSERT INTO price_snapshots (booking_id,seq,payload_json,gross_amount,commission_amount,policy_snapshot_json,engine_version) VALUES ($1,2,'{}',650000,0,'{}','test')", [one.id], '23505');
  });

  await run('BR-RATE-02: source priority, override reason and price band enforced', async (f) => {
    const rate = await insert(db, 'rate_calendars', { room_type_id: f.type.id, property_id: f.property.id, date: '2030-01-01', price: 650000, source: 'BASE', priority: 10 });
    await rejectsSQL(db, 'UPDATE rate_calendars SET priority=100 WHERE id=$1', [rate.id], '23514');
    await rejectsSQL(db, "UPDATE rate_calendars SET source='OVERRIDE', priority=100, reason=NULL WHERE id=$1", [rate.id], '23514');
    await rejectsSQL(db, 'UPDATE room_types SET min_price=max_price+1 WHERE id=$1', [f.type.id], '23514');
  });

  await run('BR-PAY-03 / BR-PAY-09: payment sign and scoped business idempotency enforced', async (f) => {
    const b = await f.booking();
    const p = await insert(db, 'payments', { booking_id: b.id, type: 'DEPOSIT', method: 'BANK_TRANSFER', amount: 100000, idempotency_key: 'deposit-1' });
    await rejectsSQL(db, 'UPDATE payments SET amount=-1 WHERE id=$1', [p.id], '23514');
    await rejectsSQL(db, "INSERT INTO payments (booking_id,type,method,amount,idempotency_key) VALUES ($1,'DEPOSIT','BANK_TRANSFER',100000,'deposit-1')", [b.id], '23505');
    await insert(db, 'payments', { booking_id: b.id, type: 'REFUND', method: 'BANK_TRANSFER', amount: -100000, idempotency_key: 'refund-1' });
  });

  await run('BR-GEN-08: HTTP key uniqueness includes principal, method and path', async () => {
    const values = { key: 'same-key', principal_type: 'GUEST', principal_id: 'guest-1', method: 'POST', path: '/api/v1/bookings', request_hash: 'hash', lease_expires_at: '2099-01-01', expires_at: '2099-01-02' };
    const key = await insert(db, 'idempotency_keys', values);
    await insert(db, 'idempotency_keys', { ...values, principal_id: 'guest-2' });
    await insert(db, 'idempotency_keys', { ...values, path: '/api/v1/holds' });
    await rejectsSQL(db, 'INSERT INTO idempotency_keys (key,principal_type,principal_id,method,path,request_hash,lease_expires_at,expires_at) SELECT key,principal_type,principal_id,method,path,request_hash,lease_expires_at,expires_at FROM idempotency_keys WHERE id=$1', [key.id], '23505');
    await rejectsSQL(db, "UPDATE idempotency_keys SET status='COMPLETED' WHERE id=$1", [key.id], '23514');
  });

  await run('Webhook inbox dedupes provider account/event; processing needs lease', async () => {
    const values = { provider: 'VNPAY', provider_account_id: 'account-1', event_id: 'event-1', payload_hash: 'hash', payload_json: {}, signature_verified_at: '2030-01-01' };
    const event = await insert(db, 'webhook_inbox', values);
    await insert(db, 'webhook_inbox', { ...values, provider_account_id: 'account-2' });
    await rejectsSQL(db, 'INSERT INTO webhook_inbox (provider,provider_account_id,event_id,payload_hash,payload_json,signature_verified_at) SELECT provider,provider_account_id,event_id,payload_hash,payload_json,signature_verified_at FROM webhook_inbox WHERE id=$1', [event.id], '23505');
    await rejectsSQL(db, "UPDATE webhook_inbox SET status='PROCESSING' WHERE id=$1", [event.id], '23514');
    await rejectsSQL(db, "UPDATE webhook_inbox SET status='PROCESSED' WHERE id=$1", [event.id], '23514');
  });

  await run('Refund net clamps at zero; ownership, independent approval and final decision enforced', async (f) => {
    const b = await f.booking();
    const refund = await insert(db, 'refund_requests', { booking_id: b.id, event_key: 'cancellation-1', policy_id: f.policy.id, hours_before_check_in: 200, refund_percent: 100, requested_amount: 100000, refund_fee: 150000, reason: 'GUEST_REQUEST', requester_type: 'GUEST', requester_id: f.guest.id });
    assert.equal(Number(refund.net_refund), 0);
    await rejectsSQL(db, 'INSERT INTO refund_requests (booking_id,event_key,policy_id,hours_before_check_in,refund_percent,requested_amount,reason,requester_type,requester_id) SELECT booking_id,event_key,policy_id,hours_before_check_in,refund_percent,requested_amount,reason,requester_type,requester_id FROM refund_requests WHERE id=$1', [refund.id], '23505');
    await rejectsSQL(db, "UPDATE refund_requests SET requester_id='someone-else' WHERE id=$1", [refund.id], '23514');
    await rejectsSQL(db, "UPDATE refund_requests SET status='APPROVED',approved_amount=100000,approved_by=$2,decided_at=now() WHERE id=$1", [refund.id, f.otherUser.id], '23514');
    await insert(db, 'refund_approvals', { refund_request_id: refund.id, request_version: 1, approver_id: f.otherUser.id, approver_role: 'OWNER', decision: 'APPROVED', approved_amount: 100000, refund_fee: 150000, reason: 'Test approval' });
    await db.query("UPDATE refund_requests SET status='APPROVED',approved_amount=100000,approved_by=$2,decided_at=now() WHERE id=$1", [refund.id, f.otherUser.id]);
    await rejectsSQL(db, 'UPDATE refund_requests SET approved_amount=200000 WHERE id=$1', [refund.id], '23514');
    await rejectsSQL(db, 'DELETE FROM refund_approvals WHERE refund_request_id=$1', [refund.id], '42501');
    await db.query("UPDATE refund_requests SET status='PAID',paid_at=now() WHERE id=$1", [refund.id]);
    assert.equal(Number((await db.query('SELECT count(*) FROM payments WHERE booking_id=$1', [b.id])).rows[0].count), 0, 'zero net refund needs no zero-value payment');
  });

  await run('Refund allocation capped by original successful payment and approved net refund', async (f) => {
    const b = await f.booking();
    const payment = await insert(db, 'payments', { booking_id: b.id, type: 'DEPOSIT', method: 'BANK_TRANSFER', amount: 100000, status: 'SUCCEEDED', paid_at: '2030-01-01', idempotency_key: 'paid' });
    const refund = await insert(db, 'refund_requests', { booking_id: b.id, event_key: 'cancellation-1', policy_id: f.policy.id, hours_before_check_in: 200, refund_percent: 100, requested_amount: 100000, reason: 'GUEST_REQUEST', requested_by: f.user.id, requester_type: 'USER', requester_id: f.user.id });
    await rejectsSQL(db, "INSERT INTO refund_approvals (refund_request_id,request_version,approver_id,approver_role,decision,approved_amount,refund_fee,reason) VALUES ($1,1,$2,'MANAGER','APPROVED',100000,0,'self')", [refund.id, f.user.id], '23514');
    await insert(db, 'refund_approvals', { refund_request_id: refund.id, request_version: 1, approver_id: f.otherUser.id, approver_role: 'OWNER', decision: 'APPROVED', approved_amount: 100000, refund_fee: 0, reason: 'Independent approval' });
    await db.query("UPDATE refund_requests SET status='APPROVED',approved_amount=100000,approved_by=$2,decided_at=now() WHERE id=$1", [refund.id, f.otherUser.id]);
    await rejectsSQL(db, 'INSERT INTO refund_allocations (refund_request_id,original_payment_id,amount) VALUES ($1,$2,100001)', [refund.id, payment.id], '23514');
    const allocation = await insert(db, 'refund_allocations', { refund_request_id: refund.id, original_payment_id: payment.id, amount: 100000 });
    await rejectsSQL(db, 'UPDATE refund_allocations SET amount=1 WHERE id=$1', [allocation.id], '23514');
    await rejectsSQL(db, "UPDATE refund_requests SET status='PAID',paid_at=now() WHERE id=$1", [refund.id], '23514');
    const payout = await insert(db, 'payments', { booking_id: b.id, type: 'REFUND', method: 'BANK_TRANSFER', amount: -100000, status: 'SUCCEEDED', paid_at: '2030-01-01', idempotency_key: 'refund-paid' });
    await db.query('UPDATE refund_allocations SET refund_payment_id=$2 WHERE id=$1', [allocation.id, payout.id]);
    await db.query("UPDATE refund_requests SET status='PAID',paid_at=now() WHERE id=$1", [refund.id]);
  });

  await run('BR-SYS-01: audit hash chain and immutable rows; application role cannot truncate', async (f) => {
    const first = await insert(db, 'audit_logs', { actor_id: f.user.id, actor_role: 'MANAGER', action: 'CREATE', entity_type: 'Booking', at: '2030-01-01T00:00:00Z' });
    const second = await insert(db, 'audit_logs', { actor_id: f.user.id, actor_role: 'MANAGER', action: 'UPDATE', entity_type: 'Booking', at: '2030-01-01T00:00:01Z' });
    const backdated = await insert(db, 'audit_logs', { actor_id: f.user.id, actor_role: 'MANAGER', action: 'BACKDATED', entity_type: 'Booking', at: '2000-01-01T00:00:00Z' });
    const fourth = await insert(db, 'audit_logs', { actor_id: f.user.id, actor_role: 'MANAGER', action: 'AFTER', entity_type: 'Booking', at: '2030-01-01T00:00:01Z' });
    assert.match(first.row_hash, /^[a-f0-9]{64}$/);
    assert.equal(second.prev_hash, first.row_hash);
    assert.equal(backdated.prev_hash, second.row_hash);
    assert.equal(fourth.prev_hash, backdated.row_hash);
    assert.ok(BigInt(fourth.chain_seq) > BigInt(backdated.chain_seq));
    assert.ok(BigInt(backdated.chain_seq) > BigInt(second.chain_seq));
    await rejectsSQL(db, "UPDATE audit_logs SET action='tampered' WHERE id=$1", [first.id], '42501');
    await rejectsSQL(db, 'DELETE FROM audit_logs WHERE id=$1', [first.id], '42501');
    const privileges = (await db.query("SELECT has_table_privilege('app_rw','audit_logs','TRUNCATE') AS truncate, has_table_privilege('app_rw','audit_logs','UPDATE') AS update")).rows[0];
    assert.equal(privileges.truncate, false);
    assert.equal(privileges.update, false);
  });

  await run('Optimistic version increments; stale expectedVersion changes no row', async (f) => {
    const b = await f.booking();
    assert.equal(Number(b.version), 1);
    const updated = await db.query("UPDATE bookings SET note='first writer' WHERE id=$1 AND version=1 RETURNING version", [b.id]);
    assert.equal(Number(updated.rows[0].version), 2);
    assert.equal((await db.query("UPDATE bookings SET note='stale writer' WHERE id=$1 AND version=1 RETURNING id", [b.id])).rows.length, 0);
    const task = await insert(db, 'housekeeping_tasks', { room_id: f.room.id, business_date: '2030-01-03' });
    assert.equal(Number(task.version), 1);
    const cleaned = await db.query("UPDATE housekeeping_tasks SET status='DONE',completed_at=now() WHERE id=$1 AND version=1 RETURNING version", [task.id]);
    assert.equal(Number(cleaned.rows[0].version), 2);
    assert.equal((await db.query("UPDATE housekeeping_tasks SET status='IN_PROGRESS' WHERE id=$1 AND version=1 RETURNING id", [task.id])).rows.length, 0);
  });

  await run('Outbox delivery dedupes each consumer/event and requires processing lease and completion time', async (f) => {
    const event = await insert(db, 'outbox_events', { event_type: 'BookingConfirmed', aggregate_type: 'Booking', aggregate_id: (await f.booking()).id, payload_json: {} });
    await insert(db, 'event_deliveries', { event_id: event.id, consumer: 'notification' });
    await insert(db, 'event_deliveries', { event_id: event.id, consumer: 'channel-sync' });
    await rejectsSQL(db, "INSERT INTO event_deliveries (event_id,consumer) VALUES ($1,'notification')", [event.id], '23505');
    await rejectsSQL(db, "UPDATE event_deliveries SET status='PROCESSING' WHERE event_id=$1", [event.id], '23514');
    await db.query("UPDATE event_deliveries SET status='PROCESSING',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '1 minute' WHERE event_id=$1", [event.id]);
    await rejectsSQL(db, "UPDATE event_deliveries SET status='COMPLETED' WHERE event_id=$1", [event.id], '23514');
    await db.query("UPDATE event_deliveries SET status='COMPLETED',completed_at=now() WHERE event_id=$1", [event.id]);
  });

  await t.test('Real PostgreSQL 16: simultaneous claims serialize and loser receives 23P01', { skip: !realPostgres && 'PGlite has one session; concurrency requires npm run test:postgres' }, async () => {
    const f = await fixture(db);
    const one = await f.bookingRoom(await f.booking());
    const two = await f.bookingRoom(await f.booking());
    const a = await db.connect();
    const b = await db.connect();
    try {
      await a.query('BEGIN'); await b.query('BEGIN');
      const sql = "INSERT INTO room_assignments (booking_room_id,room_id,start_date,end_date) VALUES ($1,$2,'2030-01-01','2030-01-03')";
      await a.query(sql, [one.id, f.room.id]);
      const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      // Capture rejection immediately, then observe actual lock waiting before commit.
      const pending = b.query(sql, [two.id, f.room.id]).then(() => null, (error) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = (await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
        if (state?.wait_event_type === 'Lock') { waiting = true; break; }
        await delay(20);
      }
      assert.ok(waiting, 'second writer must wait on the first transaction');
      await a.query('COMMIT');
      const error = await pending;
      assert.equal(error?.code, '23P01', error?.message ?? 'second claim unexpectedly succeeded');
      await b.query('ROLLBACK');
      assert.equal(Number((await db.query('SELECT count(*) FROM room_assignments WHERE room_id=$1 AND released_at IS NULL', [f.room.id])).rows[0].count), 1);
      // Opposite outcome: the first writer rolls back. The waiter must acquire
      // the unit, rather than retaining a phantom conflict from the aborted row.
      await db.query('UPDATE room_assignments SET released_at=now() WHERE room_id=$1 AND released_at IS NULL', [f.room.id]);
      await a.query('BEGIN'); await b.query('BEGIN');
      await a.query(sql, [one.id, f.room.id]);
      const afterRollback = b.query(sql, [two.id, f.room.id]).then(() => null, (error) => error);
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = (await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
        if (state?.wait_event_type === 'Lock') { blocked = true; break; }
        await delay(20);
      }
      assert.ok(blocked, 'waiter must actually block before testing rollback');
      await a.query('ROLLBACK');
      assert.equal(await afterRollback, null, 'waiter should succeed after first writer rolls back');
      await b.query('COMMIT');
      const survivors = (await db.query('SELECT booking_room_id FROM room_assignments WHERE room_id=$1 AND released_at IS NULL', [f.room.id])).rows;
      assert.deepEqual(survivors.map((row) => row.booking_room_id), [two.id]);
    } finally {
      await a.query('ROLLBACK'); await b.query('ROLLBACK');
      await a.end(); await b.end();
    }
  });
});
