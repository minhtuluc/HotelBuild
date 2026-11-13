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
  'error.channelSignature':
    'Chữ ký webhook kênh bán không hợp lệ hoặc timestamp ngoài cửa sổ cho phép.',
  'error.channelReplay':
    'Mã sự kiện OTA đã dùng với nội dung khác. Cách ly và đối soát trước khi xử lý tiếp.',
  'error.channelSyncFailed': 'Đồng bộ lên kênh bán thất bại. Hệ thống sẽ tự thử lại.',
  'error.overNoConsent': 'Cần đồng thuận của cả hai khách trước khi ghép phòng.',
  'error.overMergeGender': 'Chưa được quản lý duyệt để ghép khách khác giới tính.',
  'error.overNoPlan': 'Không còn phương án điều chuyển khả dụng; chuyển sang walk-out.',
  'error.overMoveNotAllowed':
    'Khách đã nhận phòng: cần căn cứ bất khả kháng và quản lý duyệt mới điều chuyển được.',
  'error.overApprovalRequired': 'Cần quản lý duyệt chi phí điều chuyển trước khi thực thi.',
  'error.overCrossCity': 'Khách chưa đồng ý bằng văn bản việc sang cơ sở khác thành phố.',
  'error.overCaseDeadline':
    'Ca quá tải đã quá hạn T−24h và đã leo thang. Vẫn xử lý sự cố tại chỗ, không tự đóng ca.',
  'error.compensationUnknown':
    'Chưa xác định kết quả chi bồi thường. Không chi lần mới; tra theo mã {reference}.',
  'error.boundary.body':
    'Không hiển thị chi tiết kỹ thuật. Thử lại; nếu vẫn lỗi, gửi mã tham chiếu cho hỗ trợ.',
  'error.boundary.retry': 'Thử lại',
  'access.denied.title': 'Không đủ quyền truy cập',
  'access.denied.body':
    'Tài khoản của bạn không có quyền cho khu vực này. Liên hệ quản lý cơ sở nếu cần.',
  'access.denied.back': 'Về trang chính',
  'api.probe.title': 'Trạng thái hệ thống',
  'api.probe.ok': 'Hệ thống đặt phòng đang hoạt động',
  'api.probe.failed': 'Hệ thống đặt phòng đang gián đoạn ({code})',
  'format.stayPeriod': '{nights} đêm · {adults} người lớn · {children} trẻ em',
  'format.remaining.hours': 'còn {hours} giờ {minutes} phút',
  'format.remaining.minutes': 'còn {minutes} phút',
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

/** Câu chữ F6 (CHAN + OVER) theo mã api.md §4.2 — cùng khoá với bản web. */
const F6_MESSAGE_KEYS: Readonly<Record<string, StateMessageKey>> = {
  E_CHAN_SIGNATURE_INVALID: 'error.channelSignature',
  E_CHAN_REPLAY_DETECTED: 'error.channelReplay',
  E_CHAN_SYNC_FAILED: 'error.channelSyncFailed',
  E_OVER_NO_CONSENT: 'error.overNoConsent',
  E_OVER_MERGE_GENDER: 'error.overMergeGender',
  E_OVER_NO_PLAN_AVAILABLE: 'error.overNoPlan',
  E_OVER_MOVE_NOT_ALLOWED: 'error.overMoveNotAllowed',
  E_OVER_APPROVAL_REQUIRED: 'error.overApprovalRequired',
  E_OVER_CROSS_CITY_NO_CONSENT: 'error.overCrossCity',
  E_OVER_CASE_DEADLINE_PASSED: 'error.overCaseDeadline',
};

export function f6ErrorMessage(
  code: string,
  vars?: Readonly<Record<string, string | number>>,
): string | undefined {
  const key = F6_MESSAGE_KEYS[code];
  return key === undefined ? undefined : nativeTranslate(key, vars);
}

/** Chi bồi thường timeout chưa rõ kết quả: tra theo `operationId`/`paymentId`, không tạo lần chi mới. */
export function compensationUnknownMessage(reference: string): string {
  return nativeTranslate('error.compensationUnknown', { reference });
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
