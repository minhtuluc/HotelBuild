import { makeTranslate } from '@pinehill/ui-web/messages';
export const rateText = makeTranslate({
  configName: 'cấu hình',
  confirmed: 'Máy chủ đã xác nhận lưu {code}.',
  adoptLocal: 'Giữ bản nhập, dùng phiên bản mới để lưu',
  planTable: 'Danh sách gói giá',
  emptyPlans: 'Không có gói giá đang cấu hình.',
  emptyPolicies: 'Không có chính sách huỷ đang cấu hình.',
  field: 'Trường cấu hình',
  keepPolicy: 'Giữ bản nhập sẽ thay toàn bộ bậc và ngoại lệ trả phòng sớm theo bảng đối chiếu này.',
  firstNight: 'Tính đêm đầu',
  firstNightRow: 'Tính đêm đầu — bậc {index}',
  catchAll: 'Bậc bắt tất (−1)',
  yes: 'Có',
  no: 'Không',
  offsetHelp:
    'Mốc giờ trước nhận phòng: 0 là đúng giờ nhận phòng; −1 là bậc cuối bắt tất. Các bậc lấy từ máy chủ, không tính tiền hoàn tại màn hình.',
});
