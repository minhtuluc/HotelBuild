import type { BookingBalance, BookingSummary, Payment } from '@pinehill/contracts';
export interface Offer {
  booking: BookingSummary;
  balance: BookingBalance;
}
/** Authority is exclusively the server projection. Missing on old backends means unavailable. */
export function approvedAmount(booking: BookingSummary, balance: BookingBalance): number | null {
  const amount = balance.onlineDepositAmount;
  return balance.bookingId === booking.id &&
    typeof amount === 'number' &&
    Number.isSafeInteger(amount) &&
    amount > 0
    ? amount
    : null;
}
export function sameOffer(a: Offer, b: Offer): boolean {
  return (
    a.booking.id === b.booking.id &&
    a.booking.guestId === b.booking.guestId &&
    a.booking.version === b.booking.version &&
    a.booking.status === b.booking.status &&
    a.booking.holdExpiresAt === b.booking.holdExpiresAt &&
    a.balance.onlineDepositAmount === b.balance.onlineDepositAmount &&
    a.balance.paidAmount === b.balance.paidAmount
  );
}
export function paymentMessage(payment: Pick<Payment, 'status'>, booking: BookingSummary) {
  if (payment.status === 'SUCCEEDED')
    return booking.status === 'CONFIRMED' ? 'confirmed' : 'received';
  return payment.status === 'PENDING' ? 'pending' : 'failed';
}
function isFixtureUrl(url: URL, paymentId: string, fixtureOrigin?: string): boolean {
  return (
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    url.origin === fixtureOrigin &&
    url.pathname === `/__test/f5/payments/${encodeURIComponent(paymentId)}` &&
    !url.search
  );
}
/** HTTPS supplied by authenticated server; HTTP is only the exact configured loopback fixture. */
export function safePaymentUrl(payment: Payment, fixtureOrigin?: string): string | null {
  if (!payment.paymentUrl) return null;
  try {
    const url = new URL(payment.paymentUrl);
    if (url.username || url.password || url.hash) return null;
    return url.protocol === 'https:' || isFixtureUrl(url, payment.paymentId, fixtureOrigin)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export const POLL_LIMIT = 12;
export function canPoll(
  payment: Pick<Payment, 'status' | 'expiresAt'>,
  reads: number,
  time: number,
  visible: boolean,
): boolean {
  return (
    visible &&
    reads < POLL_LIMIT &&
    payment.status === 'PENDING' &&
    (payment.expiresAt === null || time < Date.parse(payment.expiresAt))
  );
}
