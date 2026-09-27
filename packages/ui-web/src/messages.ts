/**
 * Danh mục i18n mặc định `vi-VN` (NFR-LOC-01) và bộ nội suy thuần.
 * Không phụ thuộc React → dùng được ở cả server component lẫn client component.
 */

export const viCatalog = {
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
} as const;

export type MessageKey = keyof typeof viCatalog;

export type Catalog = Readonly<Record<string, string>>;

export interface Translate {
  (key: MessageKey, vars?: Readonly<Record<string, string | number>>): string;
}

/** Thay `{tên}` bằng giá trị tương ứng; thiếu khoá thì hiện chính khoá đó để lộ ngay chỗ thiếu. */
export function makeTranslate<T extends Catalog>(catalog: T) {
  return (key: keyof T & string, vars?: Readonly<Record<string, string | number>>): string => {
    const template = catalog[key] ?? key;
    if (vars === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = vars[name];
      return value === undefined ? whole : String(value);
    });
  };
}
