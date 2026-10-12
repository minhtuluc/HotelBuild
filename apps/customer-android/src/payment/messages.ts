import type { Phase } from './flow';
export const phaseMessages: Record<Phase, string> = {
  loading: 'Đang đọc giao dịch và đặt phòng từ máy chủ…',
  ready: 'Chọn cổng thanh toán. Số cọc lấy từ máy chủ.',
  confirm: 'Kiểm tra số tiền và cổng thanh toán trước khi xác nhận.',
  pending: 'Giao dịch đang chờ. Chỉ máy chủ xác nhận kết quả thanh toán.',
  unknown:
    'Chưa biết kết quả gửi. Không tạo giao dịch khác; kiểm tra lại hoặc liên hệ lễ tân với mã tham chiếu.',
  received: 'Đã nhận tiền, đang xử lý. Trạng thái đặt phòng vẫn do máy chủ quyết định.',
  confirmed: 'Máy chủ đã xác nhận giao dịch và đặt phòng.',
  failed: 'Giao dịch không thành công. Kiểm tra lại để biết trạng thái mới nhất.',
  blocked:
    'Chưa đủ dữ liệu máy chủ để tạo thanh toán trực tuyến. Vui lòng kiểm tra lại hoặc liên hệ lễ tân.',
  forbidden: 'Không có quyền xem giao dịch này.',
  expired: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
  offline:
    'Cần kết nối mạng để đọc trạng thái hoặc thanh toán. Dữ liệu cũ không xác nhận đã trả tiền.',
  error: 'Không đọc được trạng thái máy chủ. Vui lòng kiểm tra lại.',
};
