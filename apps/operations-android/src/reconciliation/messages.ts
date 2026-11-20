/** Câu chữ SCR-68 (HB-263) — đối soát nhanh tiền mặt theo ngày VN. */
import { makeTranslate } from '@pinehill/ui-native';

export const catalog = {
  title: 'Đối soát tiền mặt',
  date: 'Ngày nghiệp vụ {date} (giờ VN)',
  hintClose: 'Đếm quỹ thực tế của từng người thu rồi chốt. Số phải có do máy chủ tính theo sổ cái.',
  hintView: 'Tổng tiền mặt bạn đã thu hôm nay. Kế toán sẽ đếm và chốt quỹ.',
  loading: 'Đang tải tổng thu…',
  empty: 'Hôm nay chưa có khoản thu tiền mặt nào.',
  failed: 'Không tải được tổng thu: {code}',
  offline: 'Cần kết nối để xem và chốt đối soát.',
  receipts: '{count} khoản tiền mặt',
  expected: 'Phải có theo sổ: {amount}',
  closed: 'Đã chốt: đếm {counted}, lệch {difference}',
  notified: 'Đã báo quản lý vì lệch vượt ngưỡng.',
  counted: 'Tiền mặt đếm được (VND)',
  note: 'Ghi chú (tuỳ chọn)',
  countedIssue: 'Nhập số tiền là số nguyên không âm.',
  submit: 'Chốt quỹ của {name}',
  submitting: 'Đang chốt…',
  done: 'Đã chốt: phải có {expected}, đếm {counted}, lệch {difference}.',
  rejected: 'Máy chủ từ chối: {code}',
  unknown: 'Chưa rõ kết quả — bấm chốt lại đúng lệnh này để đối chiếu (mã {reference}).',
  pinRequired: 'Cần mở khoá PIN lại trước khi chốt.',
  refresh: 'Tải lại',
  back: 'Về màn chính',
} as const;

export const cashText = makeTranslate(catalog);
