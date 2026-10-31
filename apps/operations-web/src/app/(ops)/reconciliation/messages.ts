import { makeTranslate } from '@pinehill/ui-web/messages';

/** Danh mục thông điệp cho SCR-39 (đối soát cuối ngày) và SCR-69 (trả phòng sớm) — HB-111. */
const messages = {
  reconcileTitle: 'Đối soát doanh thu và chốt quỹ cuối ngày',
  reconcileIntro:
    'Chốt quỹ theo (người thu, ngày nghiệp vụ VN — BR-PAY-06). Lệch trên 50.000 ₫ tự động cảnh báo quản lý (BR-PAY-10).',
  property: 'Cơ sở',
  businessDate: 'Ngày nghiệp vụ (VN)',
  reload: 'Tải dữ liệu',
  channelSection: 'Doanh thu và hoa hồng theo kênh',
  channelCode: 'Kênh',
  grossAmount: 'Doanh thu gộp',
  commissionAmount: 'Hoa hồng',
  netAmount: 'Doanh thu thuần',
  bookingsCount: 'Số đơn',
  exportCsv: 'Xuất CSV',
  exportAccepted: 'Đã tạo tác vụ xuất báo cáo: {id}',
  closeSection: 'Chốt quỹ tiền mặt cuối ngày',
  countedCash: 'Tiền mặt thực đếm (VND)',
  cashIssue: 'Tiền mặt thực đếm phải là số nguyên VND không âm.',
  note: 'Ghi chú đối soát (tuỳ chọn)',
  pinRequired: 'Cần xác thực PIN 6 chữ số trước khi thực hiện lệnh.',
  submitClose: 'Xác nhận chốt quỹ ngày',
  resultTitle: 'Kết quả đối soát máy chủ xác nhận',
  expectedCash: 'Tiền mặt kỳ vọng theo sổ: {amount}',
  countedCashResult: 'Tiền mặt thực đếm: {amount}',
  difference: 'Chênh lệch (thực đếm − kỳ vọng): {amount}',
  discrepancyAlert:
    'Cảnh báo lệch quỹ vượt ngưỡng 50.000 ₫! Hệ thống đã ghi nhận cảnh báo gửi quản lý cơ sở (BR-PAY-10).',
  auditRef: 'Mã nhật ký kiểm toán: {id}',
  earlyTitle: 'Xử lý trả phòng sớm',
  earlyIntro:
    'Xem trước phụ thu trả phòng sớm theo chính sách gói giá (BR-CANCEL-09, BR-FO-05) trước khi xác nhận trả phòng và giải phóng các đêm còn lại.',
  backToBooking: 'Quay lại chi tiết đặt phòng',
  bookingInfo: 'Đặt phòng {code} · Trạng thái {status} · Kỳ ở {checkIn} → {checkOut}',
  bookingAmounts: 'Tổng tiền: {total} · Đã thu: {paid} · Còn phải thu: {due}',
  earlyNote: 'Ghi chú trả phòng sớm (tuỳ chọn)',
  previewButton: 'Xem trước số tiền trả phòng sớm',
  previewTitle: 'Số tiền dự kiến do máy chủ tính',
  feeAmount: 'Phụ thu trả phòng sớm: {amount}',
  extrasAmount: 'Phát sinh: {amount}',
  balanceDueAfter: 'Số dư cần thu sau trả phòng sớm: {amount}',
  confirmEarly: 'Xác nhận trả phòng sớm',
  doneTitle: 'Đã hoàn tất trả phòng sớm',
  doneStatus: 'Trạng thái mới: {status} · Thời điểm: {time}',
  doneTasks: 'Số công việc buồng phòng sinh ra: {count}',
} as const;

export const opsReconcileText = makeTranslate(messages);
