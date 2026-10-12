import { makeTranslate } from '@pinehill/ui-web/messages';
export const settingsText = makeTranslate({
  expired: 'Phiên đã hết hạn. Đăng nhập lại để xem tham số.',
  login: 'Về đăng nhập',
  reload: 'Tải lại',
  conflict: 'Dữ liệu đã thay đổi. Bản nhập giữ phiên bản {version}.',
  compare: 'Tải lại và so sánh',
  current: 'Giá trị hiện tại: {value} — phiên bản {version}',
  adopt: 'Dùng phiên bản hiện tại để lưu bản nhập',
  unknown: 'Chưa xác định kết quả. Mã tra cứu: {id}',
  lookup: 'Tra cứu kết quả',
  replay: 'Gửi lại đúng yêu cầu',
  unknownHelp:
    'Tra cứu giá trị hiện tại không chứng minh yêu cầu đã lưu. Chỉ gửi lại cùng mã trong 24 giờ; quá hạn, kiểm tra nhật ký trước khi xử lý tiếp.',
  audit: 'Xem nhật ký',
  missing: 'Không có mã tra cứu hợp lệ; cần kiểm tra nhật ký.',
});
