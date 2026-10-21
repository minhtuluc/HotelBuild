/** Câu chữ SCR-62 (tra cứu booking & khách) — mọi nhãn hiển thị/trợ năng đi qua danh mục này. */
import { makeTranslate } from '@pinehill/ui-native';
import type { BookingStatus, LoyaltyTier } from '@pinehill/contracts';

export const catalog = {
  title: 'Tra cứu booking & khách',
  query: 'Mã booking, số điện thoại hoặc tên khách',
  search: 'Tra cứu',
  back: 'Về màn chính',
  idle: 'Nhập mã booking, số điện thoại hoặc tên khách rồi nhấn Tra cứu.',
  loading: 'Đang tra cứu…',
  ready: 'Kết quả tra cứu',
  empty: 'Không tìm thấy booking hoặc khách phù hợp. Kiểm tra lại từ khoá.',
  invalid: 'Nhập ít nhất 2 ký tự để tra cứu.',
  offline: 'Cần kết nối mạng để tra cứu.',
  expired: 'Phiên đã hết hạn. Hãy đăng nhập lại.',
  forbidden: 'Vai trò của bạn không được tra cứu booking và hồ sơ khách.',
  error: 'Không thể tra cứu. Vui lòng thử lại.',
  truncated: 'Còn kết quả khác. Thu hẹp từ khoá để xem thêm.',
  results: 'Kết quả tra cứu',
  bookingGroup: 'Booking',
  guestGroup: 'Khách',
  guestOfBooking: 'Khách: {name}',
  guestUnknown: 'Chưa có hồ sơ khách trong kết quả để đối chiếu',
  blacklist: 'Danh sách đen',
  blacklistUnknown: 'Chưa xác định cờ danh sách đen',
  call: 'Gọi khách',
  phone: 'SĐT: {phone}',
  email: 'Email: {email}',
  tier: 'Hạng: {tier}',
  points: 'Điểm: {points}',
  stays: 'Số lần lưu trú: {stays}',
  stay: 'Lưu trú {stay}',
  rooms: '{count} phòng',
  amount: 'Tổng {total} · còn phải thu {balance}',
  status_DRAFT: 'Nháp',
  status_HELD: 'Giữ chỗ',
  status_PENDING_PAYMENT: 'Chờ thanh toán',
  status_CONFIRMED: 'Đã xác nhận',
  status_CHECKED_IN: 'Đang ở',
  status_CHECKED_OUT: 'Đã trả phòng',
  status_CANCELLED: 'Đã huỷ',
  status_NO_SHOW: 'Không đến',
  status_EXPIRED: 'Hết hạn',
  tier_GUEST: 'Khách',
  tier_MEMBER: 'Thành viên',
  tier_SILVER: 'Bạc',
  tier_GOLD: 'Vàng',
  tier_PLATINUM: 'Bạch kim',
} as const;

export const lookupText = makeTranslate(catalog);

const STATUS_KEY: Readonly<Record<BookingStatus, keyof typeof catalog>> = {
  DRAFT: 'status_DRAFT',
  HELD: 'status_HELD',
  PENDING_PAYMENT: 'status_PENDING_PAYMENT',
  CONFIRMED: 'status_CONFIRMED',
  CHECKED_IN: 'status_CHECKED_IN',
  CHECKED_OUT: 'status_CHECKED_OUT',
  CANCELLED: 'status_CANCELLED',
  NO_SHOW: 'status_NO_SHOW',
  EXPIRED: 'status_EXPIRED',
};

const TIER_KEY: Readonly<Record<LoyaltyTier, keyof typeof catalog>> = {
  GUEST: 'tier_GUEST',
  MEMBER: 'tier_MEMBER',
  SILVER: 'tier_SILVER',
  GOLD: 'tier_GOLD',
  PLATINUM: 'tier_PLATINUM',
};

export function statusText(status: BookingStatus): string {
  return lookupText(STATUS_KEY[status]);
}

export function tierText(tier: LoyaltyTier): string {
  return lookupText(TIER_KEY[tier]);
}
