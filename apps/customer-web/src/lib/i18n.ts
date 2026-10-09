/**
 * Danh mục câu chữ của Customer Web: mở rộng danh mục dùng chung, không viết cứng trong component.
 */
import { makeTranslate, viCatalog } from '@pinehill/ui-web/messages';

export const customerCatalog = {
  ...viCatalog,
  'guest.home.title': 'Pine Hill — Đặt phòng trực tiếp',
  'guest.home.intro':
    'Khung màn hình F0: mọi màn hình nghiệp vụ của khách sẽ dùng đúng hợp đồng trạng thái và token này.',
  'guest.home.states': 'Bộ trạng thái UI dùng chung',
  'guest.home.openState': 'Mở trạng thái',
  'guest.demo.only': 'Dữ liệu minh hoạ — chưa gọi API nghiệp vụ (F0).',
  'guest.search.title': 'Tìm phòng trống',
  'guest.search.intro':
    'Chọn cơ sở, ngày nhận/trả và số khách. Kết quả tìm phòng là tồn khả dụng theo kỳ đã chọn (UC-INV-02).',
  'guest.search.property': 'Cơ sở',
  'guest.search.checkIn': 'Nhận phòng',
  'guest.search.checkOut': 'Trả phòng',
  'guest.search.adults': 'Người lớn',
  'guest.search.children': 'Trẻ em',
  'guest.search.submit': 'Tìm phòng',
  'guest.search.error': 'Không tải được danh sách cơ sở. Vui lòng thử lại.',
  'guest.search.retry': 'Thử lại',
  'guest.results.title': 'Kết quả tìm phòng',
  'guest.results.criteria': 'Kỳ {from} → {to} · {nights} đêm',
  'guest.results.invalid': 'Thiếu thông tin tìm phòng ({field}) — vui lòng chọn lại từ trang chủ.',
  'guest.results.backHome': 'Về trang chủ',
  'guest.results.error': 'Không tải được kết quả tìm phòng. Vui lòng thử lại.',
  'guest.results.retry': 'Thử lại',
  'guest.results.table': 'Loại phòng còn chỗ cho cả kỳ',
  'guest.results.col.room': 'Loại phòng',
  'guest.results.col.capacity': 'Sức chứa (người lớn)',
  'guest.results.col.available': 'Còn chỗ',
  'guest.results.col.nights': 'Số đêm',
  'guest.results.col.nightlyFrom': 'Giá từ/đêm',
  'guest.results.col.totalFrom': 'Tổng từ',
  'guest.results.col.actions': 'Thao tác',
  'guest.results.nightsRange': '{min}–{max} đêm',
  'guest.results.soldOut': 'Hết phòng',
  'guest.results.openDetail': 'Xem chi tiết & giá từng đêm',
  'guest.rooms.title': 'Chi tiết phòng & giá từng đêm',
  'guest.rooms.plan': 'Gói giá',
  'guest.rooms.error': 'Không lấy được báo giá. Vui lòng thử lại.',
  'guest.rooms.expired':
    'Báo giá đã hết hạn nên không còn hiệu lực. Bấm "Lấy giá mới" để xem giá hiện tại.',
  'guest.rooms.renew': 'Lấy giá mới',
  'guest.rooms.engine': 'Phiên bản engine báo giá: {version}',
  'guest.rooms.continue': 'Tiếp tục chọn gói & xác nhận',
  'guest.rooms.nights.title': 'Giá từng đêm theo báo giá',
  'guest.rooms.nights.note':
    'Số ở đây là nguyên văn máy chủ trả (BR-RATE-17); giao diện không nhân hệ số lại.',
  'guest.rooms.flag.clamped': 'Chạm sàn/trần',
  'guest.rooms.flag.none': '—',
  'guest.rooms.col.date': 'Đêm',
  'guest.rooms.col.basePrice': 'Giá cơ bản',
  'guest.rooms.col.nightlyPrice': 'Giá đêm',
  'guest.rooms.col.flags': 'Cờ',
  'guest.rooms.summary.subtotal': 'Tạm tính',
  'guest.rooms.summary.discount': 'Giảm giá',
  'guest.rooms.summary.total': 'Tổng phải trả',
  'guest.rooms.summary.deposit': 'Tiền cọc',
  'guest.rooms.summary.quotedAt': 'Báo giá lúc',
  'guest.rooms.summary.expiresAt': 'Hết hạn lúc',
} as const;

export type CustomerMessageKey = keyof typeof customerCatalog;

export const t = makeTranslate(customerCatalog);
