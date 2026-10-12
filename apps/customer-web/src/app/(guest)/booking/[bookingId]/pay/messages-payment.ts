export const messages = {
  title: 'Thanh toán tiền cọc',
  intro: 'Chọn cổng thanh toán. Trạng thái giao dịch và đặt phòng được kiểm tra lại từ máy chủ.',
  pending: 'Chưa có xác nhận đã nhận tiền. Không thanh toán thêm khi kết quả chưa rõ.',
  received:
    'Đã nhận tiền, đang xử lý. Trạng thái đặt phòng do máy chủ cung cấp; vui lòng kiểm tra lại hoặc liên hệ lễ tân.',
  confirmed: 'Máy chủ đã xác nhận đặt phòng và ghi nhận khoản thanh toán.',
  failed:
    'Giao dịch chưa thành công theo lần kiểm tra gần nhất. Có thể có cập nhật muộn; hãy kiểm tra trước khi thanh toán lại.',
  unavailable:
    'Máy chủ chưa cung cấp khoản cọc được phép thanh toán. Hãy tải lại hoặc liên hệ lễ tân.',
  error:
    'Không thể kiểm tra giao dịch. Hãy kiểm tra lại; chưa thể kết luận khoản tiền đã trả hay chưa.',
  check: 'Kiểm tra giao dịch',
  prepare: 'Xem lại trước khi thanh toán',
  confirm: 'Xác nhận và mở cổng thanh toán',
  portal: 'Tiếp tục tại cổng thanh toán',
  back: 'Xem đặt phòng',
  confirmInfo:
    'Bạn sắp chuyển sang cổng đã chọn để trả đúng số cọc dưới đây. Pine Hill không thu thông tin thẻ trên màn hình này.',
  poll: 'Tự kiểm tra tối đa 12 lần, dừng khi rời tab, hết hạn giao dịch hoặc có kết quả. Bạn vẫn có thể kiểm tra thủ công.',
  unknown:
    'Yêu cầu đã gửi nhưng chưa rõ kết quả. Giữ nguyên giao dịch này; không tạo khoản thanh toán khác.',
} as const;
