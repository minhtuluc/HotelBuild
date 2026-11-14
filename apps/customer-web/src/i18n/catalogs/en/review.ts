/**
 * Khoá tiếng Anh cần người duyệt trước ngày phát hành công khai (quyết định Q6, kế hoạch giao diện §2):
 * câu về huỷ, hoàn, cọc, thanh toán và chính sách. Bản demo dùng bản dịch do frontend soạn.
 * Test `catalogs.spec.ts` bảo đảm mọi khoá ở đây có thật trong danh mục.
 */
import type { AccountMessageKey, CustomerMessageKey, PaymentMessageKey } from '../index';

export const EN_NEEDS_REVIEW: {
  readonly customer: readonly CustomerMessageKey[];
  readonly account: readonly AccountMessageKey[];
  readonly payment: readonly PaymentMessageKey[];
} = {
  customer: [
    'guest.home.intro',
    'guest.book.terms.title',
    'guest.book.terms.deposit',
    'guest.book.terms.freeCancel',
    'guest.book.terms.freeCancelUnknown',
    'guest.book.payNote',
    'guest.booking.hold.expiresAt',
    'guest.booking.continueLocked',
    'guest.cancel.reason.forceMajeure',
    'guest.cancel.previewRequired',
    'guest.cancel.preview.tier',
    'guest.cancel.stale',
    'guest.cancel.result.refund',
    'guest.reschedule.feeUnknown',
    'guest.footer.note',
    'guest.fare.sampleNote',
    'guest.refund.lede',
    'guest.refund.note',
    'guest.cabin.spec.refundValue',
  ],
  account: ['consent', 'consentNote', 'phoneRegistered'],
  payment: ['pending', 'received', 'failed', 'error', 'confirmInfo', 'unknown', 'holdExpiry'],
};
