import { makeTranslate, stateMessages } from '@pinehill/ui-native';

export const catalog = {
  ...stateMessages,
  'guest.title': 'Đăng nhập khách',
  'guest.phone': 'Số điện thoại',
  'guest.password': 'Mật khẩu',
  'guest.login': 'Đăng nhập',
  'guest.register': 'Đăng ký',
  'guest.fullName': 'Họ tên',
  'guest.consent': 'Tôi đồng ý nhận thông tin khuyến mãi',
  'guest.offline': 'Cần kết nối',
  'guest.error': 'Thao tác thất bại: {code}',
  'guest.forgot': 'Quên mật khẩu',
  'guest.forgot.sent': 'Đã gửi liên kết (nếu số điện thoại có hồ sơ).',
  'guest.phoneRegistered': 'Số điện thoại đã có hồ sơ. Vui lòng liên hệ lễ tân.',
  'home.title': 'Pine Hill — Khách',
  'home.logout': 'Đăng xuất',
} as const;

export const t = makeTranslate(catalog);
