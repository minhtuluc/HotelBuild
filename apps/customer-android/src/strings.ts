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
  'nav.search': 'Tìm phòng',
  'nav.bookings': 'Đơn của tôi',
  'nav.account': 'Tài khoản',
  'journey.search.title': 'Tìm phòng',
  'journey.search.placeholder': 'Khung tìm phòng — màn hình thật ở HB-085.',
  'journey.bookings.title': 'Đơn của tôi',
  'journey.bookings.placeholder': 'Danh sách đơn — màn hình thật ở HB-079/HB-113.',
  'journey.account.title': 'Tài khoản',
  'journey.account.placeholder': 'Hồ sơ khách — màn hình thật ở HB-115.',
  'booking.title': 'Booking {code}',
  'booking.placeholder': 'Chi tiết booking mở từ deep link — màn hình thật ở HB-086.',
} as const;

export const t = makeTranslate(catalog);
