/** Câu chữ chung của số xem trước (SCR-61, SCR-64) — nhãn hiển thị/trợ năng đi qua danh mục này. */
import { makeTranslate } from '@pinehill/ui-native';

export const catalog = {
  title: 'Số xem trước (máy chủ tính)',
  loading: 'Đang tải số xem trước…',
  offline:
    'Cần kết nối mạng để xem số tiền dự kiến. Chưa có số, và đây không phải 0 ₫. Số chốt do máy chủ tính khi bạn xác nhận.',
  expired: 'Phiên đã hết hạn nên chưa có số xem trước. Hãy đăng nhập lại.',
  forbidden: 'Bạn không được xem số xem trước của booking này.',
  error:
    'Chưa có số xem trước do máy chủ chưa trả được. Đây không phải 0 ₫. Bạn vẫn xác nhận được; số chốt do máy chủ tính khi xác nhận.',
  retry: 'Tải lại số xem trước',
  computed:
    'Tính lúc {time} (giờ VN). Số xem trước không ràng buộc: số chốt do máy chủ tính lại khi bạn xác nhận.',
} as const;

export const previewText = makeTranslate(catalog);
