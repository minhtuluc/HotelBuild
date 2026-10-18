/**
 * HB-096 — `GET /bookings/{bookingId}/balance` (UC-PAY-03; BR-PAY-02; api.md §2.6, §3.5).
 *
 * Số dư đọc từ **projection sổ cái** HB-093: cột `balance_due`/`paid_amount` lệch vẫn không ảnh hưởng
 * (TD-18). QUYỀN: khách đọc booking của chính mình (404 khi không sở hữu), nhân viên tài chính theo
 * phạm vi, HOUSEKEEPING/SYSADMIN bị từ chối.
 */
import { expect, test } from 'vitest';
import { bookingBalanceSchema, errorBodySchema } from '@pinehill/contracts';
import {
  balanceRequest,
  collectRequest,
  createBooking,
  guestToken,
  otherGuestToken,
  otherPropertyId,
  otherTypeId,
  pinTokenFor,
  rows,
  staffToken,
} from './fixture.js';

const code = (response: { body: unknown }) => errorBodySchema.parse(response.body).code;

test('nhân viên đọc số dư: đã thu / còn nợ / hoàn đang giữ tách bạch', async () => {
  const token = await staffToken('FRONT_DESK');
  const { booking } = await createBooking();
  const pinToken = await pinTokenFor(token, booking.id);
  const paid = await collectRequest(
    {
      bookingId: booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: booking.depositAmount,
      pinToken,
    },
    { token },
  );
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);

  const response = await balanceRequest(booking.id, { token });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const balance = bookingBalanceSchema.parse(response.body);
  expect(balance.totalAmount).toBe(booking.totalAmount);
  expect(balance.paidAmount).toBe(booking.depositAmount);
  expect(balance.refundedAmount).toBe(0);
  expect(balance.reservedRefundAmount).toBe(0);
  expect(balance.balanceDue).toBe(booking.totalAmount - booking.depositAmount);
  expect(balance.onlineDepositAmount ?? null).toBeNull();
});

test('không đọc cột balance_due/paid_amount có thể lệch — chỉ tin projection sổ cái (TD-18)', async () => {
  const token = await staffToken('FRONT_DESK');
  const { booking } = await createBooking();
  const pinToken = await pinTokenFor(token, booking.id);
  await collectRequest(
    {
      bookingId: booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: booking.depositAmount,
      pinToken,
    },
    { token },
  );
  // Làm lệch cột dẫn xuất (mô phỏng đường huỷ ngoài dải cập nhật); projection phải bỏ qua.
  await rows(
    'UPDATE bookings SET balance_due=999999000, paid_amount=555000, refunded_amount=0 WHERE id=$1',
    [booking.id],
  );
  const response = await balanceRequest(booking.id, { token });
  expect(response.status).toBe(200);
  const balance = bookingBalanceSchema.parse(response.body);
  expect(balance.paidAmount).toBe(booking.depositAmount);
  expect(balance.balanceDue).toBe(booking.totalAmount - booking.depositAmount);
});

test('khách chỉ đọc booking của mình; khách khác ⇒ 404; thiếu bearer ⇒ 401', async () => {
  const mine = await createBooking({ token: guestToken, phone: '0900000096' });
  const own = await balanceRequest(mine.booking.id, { token: guestToken });
  expect(own.status, JSON.stringify(own.body)).toBe(200);

  const foreign = await balanceRequest(mine.booking.id, { token: otherGuestToken });
  expect(foreign.status).toBe(404);

  const anonymous = await balanceRequest(mine.booking.id, { token: null });
  expect(anonymous.status).toBe(401);
});

test('HOUSEKEEPING/SYSADMIN ⇒ 403; nhân viên ngoài cơ sở ⇒ 403 E_AUTH_OUT_OF_SCOPE', async () => {
  const { booking } = await createBooking();
  const housekeeping = await staffToken('HOUSEKEEPING');
  const denied = await balanceRequest(booking.id, { token: housekeeping });
  expect(denied.status).toBe(403);
  expect(code(denied)).toBe('E_RBAC_FORBIDDEN');

  const sysadmin = await staffToken('SYSADMIN', 'h029-second');
  const deniedSysadmin = await balanceRequest(booking.id, { token: sysadmin });
  expect(deniedSysadmin.status).toBe(403);

  const foreign = await createBooking({ property: otherPropertyId, roomType: otherTypeId });
  const frontDesk = await staffToken('FRONT_DESK');
  const outOfScope = await balanceRequest(foreign.booking.id, { token: frontDesk });
  expect(outOfScope.status).toBe(403);
  expect(code(outOfScope)).toBe('E_AUTH_OUT_OF_SCOPE');
});

test('onlineDepositAmount: khách thấy phần cọc còn thiếu khi còn giữ chỗ, null sau khi đủ cọc', async () => {
  const guest = await createBooking({ token: guestToken, phone: '0900000096' });
  const before = bookingBalanceSchema.parse(
    (await balanceRequest(guest.booking.id, { token: guestToken })).body,
  );
  expect(before.onlineDepositAmount).toBe(guest.booking.depositAmount);

  const token = await staffToken('FRONT_DESK');
  const pinToken = await pinTokenFor(token, guest.booking.id);
  await collectRequest(
    {
      bookingId: guest.booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: guest.booking.depositAmount,
      pinToken,
    },
    { token },
  );
  const after = bookingBalanceSchema.parse(
    (await balanceRequest(guest.booking.id, { token: guestToken })).body,
  );
  expect(after.onlineDepositAmount ?? null).toBeNull();
});
