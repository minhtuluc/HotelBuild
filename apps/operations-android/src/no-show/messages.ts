/** Câu chữ SCR-64 (ghi no-show) — mọi nhãn hiển thị/trợ năng đi qua danh mục này. */
import { makeTranslate } from '@pinehill/ui-native';

export const catalog = {
  title: 'Ghi no-show {code}',
  stay: 'Nhận phòng {checkIn}',
  paid: 'Đã thu {paid}',
  countdown: 'Còn {time} tới mốc được ghi no-show ({mark}, giờ VN)',
  countdownReached: 'Đã tới mốc được ghi no-show',
  countdownUnknown: 'Chưa có mốc ghi no-show từ máy chủ (cần số xem trước).',
  countdownNote:
    'Đếm ngược chỉ để tham khảo theo mốc máy chủ trả; máy chủ quyết định đã tới mốc hay chưa và từ chối nếu chưa tới.',
  previewPenalty: 'Phụ thu/phạt dự kiến: {amount}',
  previewRefund: 'Hoàn dự kiến: {amount}',
  policy:
    'Theo BR-CANCEL-10/BR-FO-02, no-show áp bậc cuối của chính sách huỷ (hoàn 0%) cộng phụ thu đêm đầu nếu bậc quy định; khoản này ghi công nợ, không tự thu. Số xem trước ở trên do máy chủ tính và không ràng buộc; số chốt hiện sau khi bạn xác nhận.',
  reasonLabel: 'Lý do ghi no-show',
  reasonDefault: 'Khách không đến nhận phòng',
  reasonEmpty: 'Nhập lý do ghi no-show.',
  reasonTooLong: 'Lý do tối đa 500 ký tự.',
  submit: 'Xác nhận no-show',
  submitting: 'Đang gửi…',
  back: 'Quay lại',
  close: 'Về danh sách',
  reconcile: 'Làm mới để đối soát',
  offlineBlock: 'Cần kết nối mạng để ghi no-show. Không có thao tác nào được gửi hoặc xếp hàng.',
  done: 'Máy chủ đã ghi no-show {code} lúc {time}.',
  penalty: 'Số tiền máy chủ tính: {amount}',
  refundRequest: 'Yêu cầu hoàn tạo ra: {value}',
  rejected: 'Máy chủ từ chối ghi no-show',
  rejectedCode: 'Mã lỗi: {code}',
  rejectedReason: 'Lý do máy chủ trả: {reason}',
  conflict: 'Dữ liệu booking đã thay đổi. Về danh sách, làm mới rồi thử lại.',
  failForbidden: 'Bạn không có quyền ghi no-show cho booking này hoặc phiên đã hết hạn.',
  unknownOutcome:
    'Chưa xác định kết quả (mã tham chiếu: {reference}). Làm mới danh sách để đối soát; bấm xác nhận lại sẽ dùng cùng khoá nên không ghi hai lần.',
} as const;

export const noShowText = makeTranslate(catalog);
