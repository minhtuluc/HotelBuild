import { makeTranslate } from '@pinehill/ui-web/messages';
export const allotmentText = makeTranslate({
  reload: 'Tải lại dữ liệu',
  unconfigured: 'Chưa cấu hình',
  unknownUsed: 'Chưa có số đã dùng cho ngày chưa cấu hình.',
  saved: 'Đã cập nhật lô hạn mức. Số liệu hiện tại được đọc lại từ máy chủ.',
  received: 'Máy chủ đã xác nhận lô. Đang đọc lại số liệu hiện tại.',
  current: 'Phiên bản hiện tại: {tag}',
  prior: 'Bản nhập đang giữ phiên bản: {tag}',
  adopt: 'Dùng phiên bản hiện tại để lưu bản nhập',
  compare: 'Ngày {date}: hiện tại {value}',
  scroll: 'Bảng hạn mức theo ngày',
  empty: 'Chưa có cấu hình trong khoảng này. Nhập rõ hạn mức để tạo cấu hình; ô trống không gửi.',
  direct:
    'Hạn mức lưu ở bảng là cấu hình, không phải tồn bán hiệu lực. WEB, PHONE, WALKIN dùng tồn chung; tồn hiệu lực do máy chủ quyết định.',
});
