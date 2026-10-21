/** Câu chữ riêng của màn hình đăng nhập/PIN cho Operations Android. */
import { makeTranslate, stateMessages } from '@pinehill/ui-native';

export const catalog = {
  ...stateMessages,
  'login.title': 'Đăng nhập Pine Hill',
  'session.restoring': 'Đang khôi phục phiên',
  'login.username': 'Tên đăng nhập',
  'login.password': 'Mật khẩu',
  'login.submit': 'Đăng nhập',
  'login.offline': 'Cần kết nối',
  'login.error': 'Đăng nhập thất bại: {code}',
  'changePassword.title': 'Đổi mật khẩu',
  'changePassword.current': 'Mật khẩu hiện tại',
  'changePassword.next': 'Mật khẩu mới (8–128 ký tự)',
  'changePassword.submit': 'Đổi mật khẩu',
  'changePassword.required': 'Bạn phải đổi mật khẩu tạm trước khi tiếp tục.',
  'pin.setup.title': 'Đặt PIN',
  'pin.setup.hint': 'Nhập PIN 6 số hai lần để xác nhận.',
  'pin.setup.entry': 'PIN lần {number}',
  'pin.setup.mismatch': 'Hai lần nhập không khớp.',
  'pin.prompt': 'Nhập PIN để mở khoá',
  'pin.locked': 'PIN tạm khoá.',
  'property.select': 'Chọn cơ sở đang làm việc',
  'property.open': 'Làm việc tại',
  'home.title': 'Pine Hill — Vận hành',
  'home.tasks': 'Nhiệm vụ buồng phòng của tôi',
  'home.lookup': 'Tra cứu booking & khách',
  'home.pinDemo': 'Thử thao tác cần PIN',
  'home.pinDemo.ok': 'Đã mở khoá PIN: {purpose}',
  'home.logout': 'Đăng xuất',
} as const;

export const t = makeTranslate(catalog);
export type AuthMessageKey = keyof typeof catalog;
