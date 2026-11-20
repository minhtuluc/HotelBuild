/**
 * HB-275 — câu chữ app khách bằng English. Bộ khoá theo tiếng Việt; thiếu khoá thì báo lỗi khi biên dịch.
 * Bản dịch do Claude soạn — nên có người bản ngữ đọc lại trước khi phát hành.
 */
import type { PaymentCatalog, PhaseCatalog } from '../../payment/messages';

export const enPayment: PaymentCatalog = {
  title: 'Pay deposit',
  reading: 'Checking with the server',
  changed: 'The amount or booking has changed. Reload the latest data, then confirm again.',
  handoffFailed:
    'The browser could not be opened. The transaction is kept; check again or reopen the same transaction.',
  backToBookings: 'Back to my bookings',
  booking: 'Booking {code}',
  money: '{amount} ₫',
  total: 'Room total: {amount}',
  paid: 'Paid: {amount}',
  balance: 'Outstanding balance: {amount}',
  deposit: 'Deposit due: {amount}',
  unavailableAmount: 'Not available yet',
  bookingStatus: 'Booking status: {status}',
  holdExpiry: 'Hold expires: {time}. The hold deadline is separate from the payment transaction.',
  transaction: 'Transaction ID: {id}',
  paymentStatus: 'Transaction status: {status}',
  checkedAt: 'Checked with the server at {time}',
  provider: 'Payment gateway',
  providerVnpay: 'VNPay',
  providerMomo: 'MoMo',
  prepare: 'Review before paying',
  confirmInfo:
    'Selected gateway: {provider}. Payment opens in the system browser; we check with the server again when you return.',
  confirm: 'Confirm and open the payment gateway',
  reopen: 'Reopen the payment gateway for this transaction',
  unsafeUrl:
    'The server has not returned a secure HTTPS link yet. Please check the transaction status.',
  reference: 'Reference: {id}',
  login: 'Back to sign in',
  check: 'Check again with the server',
};

export const enPhases: PhaseCatalog = {
  loading: 'Reading the transaction and booking from the server…',
  ready: 'Choose a payment gateway. The deposit amount comes from the server.',
  confirm: 'Check the amount and gateway before confirming.',
  pending: 'The transaction is pending. Only the server confirms the payment result.',
  unknown:
    "The result is not known yet. Don't start another transaction; check again or contact the front desk with the reference.",
  received:
    'Payment received and being processed. The booking status is still decided by the server.',
  confirmed: 'The server confirmed the transaction and booking.',
  failed: 'The transaction did not succeed. Check again for the latest status.',
  blocked:
    "There isn't enough server data to start an online payment yet. Please check again or contact the front desk.",
  forbidden: "You don't have permission to view this transaction.",
  expired: 'Your session has expired. Please sign in again.',
  offline:
    'You need a connection to check the status or pay. Older data does not confirm a payment.',
  error: "Couldn't read the status from the server. Please check again.",
};
