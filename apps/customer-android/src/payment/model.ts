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
/** PSP URL is supplied by the authenticated server, never by a deep-link query. */
export function safePaymentUrl(payment: Payment): string | null {
  if (!payment.paymentUrl) return null;
  try {
    const url = new URL(payment.paymentUrl);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function paymentReturnUrl(bookingId: string): string {
  return 'pinehill-customer://payment/' + encodeURIComponent(bookingId);
}
export function isPaymentReturn(raw: string, bookingId: string): boolean {
  try {
    const url = new URL(raw);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      url.protocol === 'pinehill-customer:' &&
      url.hostname === 'payment' &&
      url.pathname === '/' + encodeURIComponent(bookingId)
    );
  } catch {
    return false;
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

/** SecureStore rejects colon/percent/slashes. Fixed-width UTF16 hex preserves identity without collisions. */
export function intentStorageKey(guestId: string, bookingId: string): string {
  const encode = (value: string) =>
    value
      .split('')
      .map((c) => c.charCodeAt(0).toString(16).padStart(4, '0'))
      .join('');
  return 'pinehill.payment.' + encode(guestId) + '.' + encode(bookingId);
}
