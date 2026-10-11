import { makeTranslate } from '@pinehill/ui-native';

const catalog = {
  cancel: 'Huỷ đặt phòng',
  reschedule: 'Đổi ngày lưu trú',
  loading: 'Đang tải đặt phòng',
  current: 'Đơn {code} · {checkIn} → {checkOut}',
  total: 'Giá phòng hiện tại: {amount}',
  guestReason: 'Khách yêu cầu huỷ',
  forceReason: 'Bất khả kháng',
  note: 'Lý do / ghi chú',
  evidence: 'Mã minh chứng (cách nhau bằng dấu phẩy)',
  checkIn: 'Ngày nhận phòng mới (YYYY-MM-DD)',
  checkOut: 'Ngày trả phòng mới (YYYY-MM-DD)',
  preview: 'Xem trước',
  confirm: 'Xác nhận theo bản xem trước',
  retry: 'Tra lại kết quả bằng yêu cầu cũ',
  reload: 'Tải lại đặt phòng',
  back: 'Về chi tiết đơn',
  login: 'Đăng nhập lại',
  applied: 'Bậc đang áp dụng: {tier} · tỷ lệ hoàn {percent}% · {hours} giờ trước nhận phòng',
  paid: 'Đã thu: {amount}',
  requested: 'Tiền hoàn máy chủ đề xuất: {amount}',
  fee: 'Phí hoàn: {amount}',
  penalty: 'Nợ phạt: {amount}',
  quoted: 'Giá phòng kỳ mới: {amount}',
  expiry: 'Báo giá hết hạn lúc {time}',
  roomPriceOnly:
    'Đây là báo giá phòng để tham khảo. Chưa thể xác nhận đổi ngày khi chưa có tổng tiền, cọc giữ lại, số dư và phí do khách sạn xác nhận.',
  feeUnavailable:
    'Chưa thể xác nhận đổi ngày: thiếu bản xem trước tổng nghĩa vụ tiền và phí. Vui lòng liên hệ lễ tân.',
  contactStaff: 'Cần hỗ trợ huỷ trong trường hợp đặc biệt? Vui lòng liên hệ lễ tân.',
  doneCancel: 'Máy chủ đã xác nhận huỷ. Trạng thái yêu cầu hoàn: {status}.',
  doneReschedule: 'Máy chủ đã xác nhận kỳ mới: {checkIn} → {checkOut}.',
  noRefund: 'Không có yêu cầu hoàn',
  notice: 'Không thực hiện được: {code}. Dữ liệu nhập vẫn được giữ.',
  offline: 'Cần kết nối mạng để xem trước hoặc xác nhận. Chưa có xác nhận mới từ máy chủ.',
  changed: 'Bản xem trước đã thay đổi. Hãy đọc lại số tiền và xác nhận lần nữa.',
  unknown: 'Chưa rõ kết quả. Giữ nguyên yêu cầu cũ để tra lại; đừng tạo một yêu cầu mới.',
  waiting: 'Máy chủ đang xử lý. Hãy chờ theo thời gian yêu cầu rồi tra lại bằng yêu cầu cũ.',
  reconcile: 'Yêu cầu đã quá 24 giờ. Liên hệ lễ tân để đối chiếu kết quả trước khi gửi lệnh mới.',
  forbidden: 'Bạn không còn quyền thao tác đơn này.',
  expired: 'Phiên đã hết hạn. Hãy đăng nhập lại.',
  conflict: 'Dữ liệu đã đổi. Tải lại đặt phòng và xem trước lần nữa.',
  failed: 'Không tải được dữ liệu. Hãy thử lại khi có kết nối.',
  missingVersion: 'Chưa tải được phiên bản đặt phòng. Hãy tải lại trước khi thao tác.',
  storage: 'Đã nhận xác nhận, nhưng chưa dọn được yêu cầu lưu trên máy. Tải lại để đối chiếu.',
} as const;
export const changeText = makeTranslate(catalog);
export type ChangeTextKey = keyof typeof catalog;
export function noticeText(code: string): string {
  return isTextKey(code) ? changeText(code) : changeText('notice', { code });
}

function isTextKey(code: string): code is ChangeTextKey {
  return Object.hasOwn(catalog, code);
}
