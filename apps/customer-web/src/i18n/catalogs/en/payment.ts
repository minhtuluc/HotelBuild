/** Bản tiếng Anh của SCR-06 (thanh toán tiền cọc) — HB-312. */
import type { PaymentMessageKey } from '../vi/payment';

export const enPayment: Readonly<Record<PaymentMessageKey, string>> = {
  title: 'Pay the deposit',
  intro: 'Choose a payment gateway. Transaction and booking status are re-checked with the server.',
  pending:
    'No confirmation that the money was received yet. Do not pay again while the result is unclear.',
  received:
    'Payment received and being processed. The booking status comes from the server; please check again or contact reception.',
  confirmed: 'The server has confirmed the booking and recorded the payment.',
  failed:
    'The transaction did not succeed as of the latest check. Updates can arrive late; check before paying again.',
  unavailable:
    'The server has not provided a deposit that can be paid. Reload or contact reception.',
  error:
    'The transaction could not be checked. Check again; it is not yet possible to tell whether the money was paid.',
  check: 'Check transaction',
  prepare: 'Review before paying',
  confirm: 'Confirm and open the payment gateway',
  portal: 'Continue at the payment gateway',
  back: 'View booking',
  confirmInfo:
    'You are about to go to the chosen gateway to pay exactly the deposit below. Pine Hill does not collect card details on this screen.',
  poll: 'Checks automatically up to 12 times and stops when you leave the tab, the transaction expires or there is a result. You can still check manually.',
  unknown:
    'The request was sent but the result is unclear. Keep this transaction; do not create another payment.',
  currentVersion: 'new server version',
  previousVersion: 'previous version',
  methodRequired: 'Choose VNPay or MoMo.',
  summaryBooking: 'Booking {code}',
  total: 'Room total',
  paid: 'Received',
  balance: 'Balance per ledger',
  deposit: 'Deposit due per server',
  bookingStatus: 'Booking status from the server',
  holdExpiry: 'Hold expires: {time}. The hold is independent of the payment transaction.',
  provider: 'Payment gateway',
  providerVnpay: 'VNPay',
  providerMomo: 'MoMo',
  selectedProvider: 'Chosen gateway: {provider}.',
  observed: 'Transaction checked',
  transaction: 'Transaction ID:',
  paymentStatus: 'Amount: {amount} · Server status: {status}',
  paymentExpiry: 'Transaction expires: {time}.',
};
