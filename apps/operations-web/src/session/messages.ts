import { makeTranslate } from '@pinehill/ui-web/messages';

/**
 * Câu chữ SCR-14 (đăng nhập, đổi mật khẩu bắt buộc, chọn cơ sở, thanh đầu trang). Danh mục chung
 * (`lib/i18n.ts`) nằm ngoài phạm vi ticket nên màn tự khai báo tại chỗ theo mẫu `front-desk/messages.ts`.
 */
const messages = {
  appName: 'Pine Hill — Vận hành',
  // Đăng nhập
  loginTitle: 'Đăng nhập nhân viên',
  loginIntro: 'Dùng tài khoản nội bộ được cấp để vào hệ thống vận hành.',
  username: 'Tên đăng nhập',
  password: 'Mật khẩu',
  signIn: 'Đăng nhập',
  signingIn: 'Đang đăng nhập…',
  expired: 'Phiên đã hết hạn. Hãy đăng nhập lại.',
  formInvalid: 'Kiểm tra lại {count} trường chưa hợp lệ.',
  required: 'Bắt buộc nhập.',
  usernameLength: 'Tên đăng nhập gồm 3–64 ký tự.',
  passwordLength: 'Mật khẩu gồm 8–128 ký tự.',
  loginInvalid: 'Tên đăng nhập hoặc mật khẩu không đúng.',
  loginLocked: 'Tài khoản tạm khoá do nhập sai nhiều lần. Thử lại sau {wait}.',
  loginLockedNoWait:
    'Tài khoản tạm khoá do nhập sai nhiều lần. Thử lại sau ít phút hoặc liên hệ quản trị.',
  loginRateLimited: 'Quá nhiều lần thử đăng nhập. Thử lại sau {wait}.',
  loginRateLimitedNoWait: 'Quá nhiều lần thử đăng nhập. Chờ một lát rồi thử lại.',
  loginNetwork: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
  loginUnknown: 'Không thể đăng nhập (mã {code}). Thử lại hoặc liên hệ quản trị.',
  // Đổi mật khẩu
  changeTitle: 'Đổi mật khẩu',
  changeRequired: 'Bạn phải đổi mật khẩu tạm trước khi tiếp tục.',
  changeIntro: 'Nhập mật khẩu hiện tại và mật khẩu mới (8–128 ký tự).',
  currentPassword: 'Mật khẩu hiện tại',
  newPassword: 'Mật khẩu mới',
  confirmPassword: 'Nhập lại mật khẩu mới',
  mismatch: 'Mật khẩu xác nhận không khớp.',
  newLength: 'Mật khẩu mới gồm 8–128 ký tự.',
  changeSubmit: 'Đổi mật khẩu',
  changeSubmitting: 'Đang đổi mật khẩu…',
  changeWrongCurrent: 'Mật khẩu hiện tại không đúng.',
  changeInvalid: 'Mật khẩu mới không hợp lệ. Kiểm tra độ dài 8–128 ký tự.',
  changeRateLimited: 'Quá nhiều lần thử. Chờ một lát rồi thử lại.',
  changeForbidden: 'Bạn không có quyền đổi mật khẩu hoặc phiên đã hết hạn. Hãy đăng nhập lại.',
  changeUnknown:
    'Chưa xác định kết quả đổi mật khẩu. Thử đăng nhập bằng mật khẩu mới; nếu không được, dùng mật khẩu cũ.',
  // Chọn cơ sở
  propertyTitle: 'Chọn cơ sở đang làm việc',
  propertyIntro:
    'Chọn cơ sở bạn làm việc hôm nay. Có thể đổi ở thanh đầu trang mà không cần đăng nhập lại.',
  propertyLegend: 'Cơ sở đang làm việc',
  propertyContinue: 'Tiếp tục',
  propertyRequired: 'Hãy chọn một cơ sở.',
  propertyNone: 'Tài khoản chưa được cấp cơ sở nào. Liên hệ quản trị để được cấp quyền.',
  // Thanh đầu trang và cổng phiên
  barLabel: 'Phiên làm việc',
  barProperty: 'Làm việc tại',
  barUser: '{name} ({role})',
  signOut: 'Đăng xuất',
  checking: 'Đang kiểm tra phiên…',
  checkFailed: 'Không kiểm tra được phiên đăng nhập. Kiểm tra mạng rồi thử lại.',
  retry: 'Thử lại',
} as const;

export const authText = makeTranslate(messages);
