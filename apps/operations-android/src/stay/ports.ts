/** Nối SCR-59/60/61 với tuyến đọc/ghi có sẵn qua `@pinehill/api-client` (không thêm endpoint). */
import { createAuthApi, createBookingApi, createPaymentApi } from '@pinehill/api-client';
import {
  checkOutRequestSchema,
  checkOutResponseSchema,
  paymentCreateRequestSchema,
  paymentSchema,
  type CheckOutResponse,
  type Payment,
} from '@pinehill/contracts';
import type { Session } from '../session';
import type { CheckOutBody, CollectBody } from './model';
import type { BalancePorts, DeparturesPorts } from './reader';
import type { PinnedPorts } from './writer';

export function departuresPorts(session: Session): DeparturesPorts {
  return {
    now: () => new Date(),
    bookings: async (query) => (await createBookingApi(session.resourceClient()).list(query)).data,
  };
}

export function balancePorts(session: Session): BalancePorts {
  return {
    balance: async (bookingId) =>
      (await createPaymentApi(session.resourceClient()).balance(bookingId)).data,
  };
}

/**
 * `pin/verify` gắn token với người + booking. Dùng client ghim token hiện tại, **một lần gửi, không tự
 * refresh/gửi lại**: client của `Session` gửi lại sau khi refresh khi nhận 401, mà sai PIN trả đúng 401
 * `E_AUTH_PIN_REQUIRED` nên mỗi lần nhập sai sẽ bị đếm hai lần vào ngưỡng khoá 3 lần (QĐ-03 quyết định 4).
 * Token chỉ trả về cho writer, không để lại trong `Session`.
 */
export async function unlockPin(session: Session, pin: string, bookingId: string): Promise<string> {
  return (await createAuthApi(session.resourceClient()).pinVerify(pin, bookingId)).data.pinToken;
}

type Shared = Pick<PinnedPorts<never, never>, 'online' | 'verifyPin' | 'createId'>;

/** Lệnh ghi dùng client ghim token/phiên hiện tại, một lần gửi; `pinToken` nằm trong thân theo hợp đồng. */
export function collectPorts(session: Session, shared: Shared): PinnedPorts<CollectBody, Payment> {
  return {
    ...shared,
    send: async (body, pinToken, idempotencyKey) =>
      (
        await session.resourceClient().request({
          method: 'POST',
          path: '/payments',
          body: paymentCreateRequestSchema.parse({ ...body, pinToken }),
          idempotencyKey,
          decoder: paymentSchema,
        })
      ).data,
    matches: (body, payment) =>
      payment.bookingId === body.bookingId &&
      payment.type === 'BALANCE' &&
      payment.amount === body.amount,
  };
}

export function checkOutPorts(
  session: Session,
  shared: Shared,
): PinnedPorts<CheckOutBody, CheckOutResponse> {
  return {
    ...shared,
    send: async (body, pinToken, idempotencyKey) =>
      (
        await session.resourceClient().request({
          method: 'POST',
          path: '/front-office/check-out',
          body: checkOutRequestSchema.parse({ ...body, pinToken }),
          idempotencyKey,
          decoder: checkOutResponseSchema,
        })
      ).data,
    matches: (body, result) =>
      result.bookingId === body.bookingId && result.status === 'CHECKED_OUT',
  };
}
