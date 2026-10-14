import { makeTranslate } from '@pinehill/ui-native';
import type { TaskWritePhase } from './writer';
export const writeText = makeTranslate({
  idle: 'Kiểm tra yêu cầu đã lưu trước khi cập nhật nhiệm vụ.',
  checking: 'Đang kiểm tra phiên và yêu cầu đã lưu…',
  ready: 'Chọn thao tác cho nhiệm vụ. Máy chủ sẽ kiểm tra trạng thái và quyền hiện tại.',
  sending: 'Đang gửi yêu cầu. Chưa xác nhận thay đổi.',
  saved: 'Máy chủ đã xác nhận cập nhật. Tải lại danh sách để xem trạng thái hiện tại.',
  unknown:
    'Chưa xác định kết quả. Có thể gửi lại cùng yêu cầu khi có mạng. Tải danh sách không xác nhận yêu cầu này.',
  needsReview:
    'Yêu cầu cần đối soát trước khi thao tác tiếp. Liên hệ quản lý; không tạo lại yêu cầu đang chờ.',
  storageError: 'Chưa lưu được yêu cầu an toàn. Kiểm tra bộ nhớ rồi gửi lại cùng yêu cầu.',
  validation: 'Dữ liệu nhiệm vụ không hợp lệ. Tải lại danh sách.',
  conflict: 'Nhiệm vụ đã thay đổi. Tải lại danh sách rồi chọn thao tác mới.',
  rejected: 'Máy chủ từ chối thay đổi này. Kiểm tra lại trạng thái nhiệm vụ.',
  expired: 'Phiên đã hết hạn. Đăng nhập lại trước khi thao tác.',
  forbidden: 'Không thể cập nhật nhiệm vụ trong phiên hoặc phạm vi hiện tại.',
  error: 'Không thể kiểm tra yêu cầu. Kiểm tra kết nối rồi thử lại.',
  inspect: 'Kiểm tra yêu cầu đã lưu',
  retry: 'Gửi lại yêu cầu đang chờ',
  start: 'Bắt đầu dọn phòng {code}',
  done: 'Báo dọn xong phòng {code}',
});
export const phaseText = (phase: TaskWritePhase): string => writeText(phase);
