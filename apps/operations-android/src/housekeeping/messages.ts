import { makeTranslate } from '@pinehill/ui-native';
import type { HousekeepingTask } from '@pinehill/contracts';
export const taskText = makeTranslate({
  title: 'Nhiệm vụ buồng phòng của tôi',
  date: 'Ngày VN (YYYY-MM-DD)',
  load: 'Tải danh sách',
  back: 'Về màn chính',
  idle: 'Nhấn tải danh sách để xem nhiệm vụ trong ngày.',
  loading: 'Đang tải nhiệm vụ…',
  empty: 'Không có nhiệm vụ được giao cho bạn trong ngày này.',
  validation: 'Nhập ngày hợp lệ theo dạng YYYY-MM-DD.',
  offline: 'Cần kết nối mạng để đọc nhiệm vụ hiện tại.',
  expired: 'Phiên đã hết hạn. Hãy đăng nhập lại.',
  forbidden: 'Bạn không có quyền xem nhiệm vụ trong lựa chọn này.',
  error: 'Không thể tải danh sách. Vui lòng thử lại.',
  pending: 'Chờ thực hiện',
  inProgress: 'Đang thực hiện',
  done: 'Đã hoàn thành',
  inspected: 'Đã kiểm tra',
  room: 'Phòng {code}',
  assigned: 'Danh sách nhiệm vụ được giao cho tôi',
});
export function statusText(status: HousekeepingTask['status']): string {
  switch (status) {
    case 'PENDING':
      return taskText('pending');
    case 'IN_PROGRESS':
      return taskText('inProgress');
    case 'DONE':
      return taskText('done');
    case 'INSPECTED':
      return taskText('inspected');
  }
}
