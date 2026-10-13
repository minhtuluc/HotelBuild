import { makeTranslate } from '@pinehill/ui-web/messages';
export const adminText = makeTranslate({
  expired: 'Phiên đã hết hạn. Đăng nhập lại để quản trị.',
  login: 'Về đăng nhập',
  unknown: 'Chưa xác định kết quả. Mã tra cứu: {id}',
  unknownHelp:
    'Tra cứu danh mục không chứng minh yêu cầu đã hoàn tất. Chỉ gửi lại đúng mã/thân yêu cầu trong 24 giờ; quá hạn cần kiểm tra nhật ký.',
  lookup: 'Tra cứu kết quả',
  retry: 'Gửi lại đúng yêu cầu',
  invalidIntent: 'Không có mã yêu cầu hợp lệ; cần kiểm tra nhật ký.',
  conflict: 'Dữ liệu đã thay đổi. Bản nhập giữ phiên bản {version}.',
  compare: 'Tải lại và so sánh',
  adopt: 'Dùng phiên bản hiện tại để lưu bản nhập',
  current: 'Phiên bản hiện tại: {version} · {name}',
  audit: 'Xem nhật ký',
});
