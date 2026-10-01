/**
 * Danh mục câu chữ trạng thái cho Android — cùng khoá với `@pinehill/ui-web` (NFR-LOC-01).
 * Test đối chiếu khoá giữa hai nền tảng để không lệch câu chữ.
 */
import { makeTranslate } from './translate.js';

export const stateMessages = {
  'common.skipToContent': 'Bỏ qua tới nội dung chính',
  'state.loading': 'Đang tải…',
  'state.refreshing': 'Cập nhật lúc {time}',
  'state.refreshing.stale': 'Đang hiển thị dữ liệu cũ',
  'state.empty.noData': 'Chưa có dữ liệu',
  'state.empty.filtered': 'Không có kết quả khớp bộ lọc',
  'state.empty.soldOut': 'Hết phòng cho kỳ đã chọn',
  'state.empty.create': 'Tạo mới',
  'state.validation': 'Vui lòng sửa {count} trường được đánh dấu',
  'state.validation.field': '{field}: {issue}',
  'state.forbidden': 'Bạn không có quyền xem nội dung này',
  'state.conflict': 'Dữ liệu đã thay đổi: bản của bạn {attempted}, bản hiện tại {current}',
  'state.conflict.reload': 'Tải lại và so sánh',
  'state.expired': 'Nội dung đã hết hạn lúc {time}',
  'state.expired.reload': 'Tải lại',
  'state.unknownOutcome': 'Chưa xác định kết quả. Không gửi lại; tra cứu theo mã {reference}',
  'state.unknownOutcome.lookup': 'Tra cứu kết quả',
  'state.success': 'Máy chủ đã xác nhận',
  'action.enterPin': 'Nhập lại PIN',
  'action.reauth': 'Đăng nhập lại',
  'action.changePassword': 'Đổi mật khẩu',
  'action.requestNewLink': 'Yêu cầu liên kết mới',
  'action.requestAccess': 'Yêu cầu quyền',
  'action.notFound': 'Về danh sách',
  'action.newKey': 'Gửi lại với khoá mới',
  'action.retryAfter': 'Thử lại sau ít phút',
  'action.reloadAndDiff': 'Tải lại và đối chiếu',
  'action.restartQuote': 'Lấy báo giá mới',
  'action.reloadAndReselect': 'Tải lại và chọn lại',
  'action.fixFields': 'Sửa các trường báo lỗi',
  'action.retryLater': 'Thử lại sau',
  'action.contactSupport': 'Liên hệ hỗ trợ',
  'error.boundary.title': 'Màn hình gặp lỗi không mong đợi',
  'error.accountLocked': 'Tài khoản đang tạm khoá. Thử lại sau {minutes} phút.',
  'error.rateLimited': 'Bạn đã gửi quá nhiều yêu cầu. Thử lại sau {minutes} phút.',
  'error.boundary.body':
    'Không hiển thị chi tiết kỹ thuật. Thử lại; nếu vẫn lỗi, gửi mã tham chiếu cho hỗ trợ.',
  'error.boundary.retry': 'Thử lại',
  'access.denied.title': 'Không đủ quyền truy cập',
  'access.denied.body':
    'Tài khoản của bạn không có quyền cho khu vực này. Liên hệ quản lý cơ sở nếu cần.',
  'access.denied.back': 'Về trang chính',
  'api.probe.title': 'Kết nối API',
  'api.probe.ok': 'Máy chủ trả lời bình thường',
  'api.probe.failed': 'Không gọi được API: {code}',
} as const satisfies Record<string, string>;

export type StateMessageKey = keyof typeof stateMessages;

const nativeTranslate = makeTranslate(stateMessages);

/** Mã có thời gian chờ hiển thị, cùng khoá với web (QĐ-03 T5). */
const WAIT_MESSAGES: Readonly<Record<string, StateMessageKey>> = {
  E_AUTH_ACCOUNT_LOCKED: 'error.accountLocked',
  E_GEN_RATE_LIMITED: 'error.rateLimited',
};

/** Câu chữ kèm thời gian chờ suy từ `retryAfterSeconds`; `undefined` nếu mã không chờ được. */
export function waitMessage(code: string, retryAfterSeconds: number): string | undefined {
  const key = WAIT_MESSAGES[code];
  if (key === undefined) return undefined;
  return nativeTranslate(key, { minutes: Math.max(1, Math.ceil(retryAfterSeconds / 60)) });
}

/** Trạng thái hàng đợi ngoại tuyến là trạng thái UI cục bộ (§8.3), không phải trạng thái nghiệp vụ. */
export type OfflineQueueState =
  'draft' | 'pendingSync' | 'sending' | 'confirmed' | 'needsAttention';

export const offlineQueueMessages = {
  draft: 'Bản nháp',
  pendingSync: 'Chờ đồng bộ',
  sending: 'Đang gửi',
  confirmed: 'Đã xác nhận',
  needsAttention: 'Cần xử lý',
} as const satisfies Record<OfflineQueueState, string>;
