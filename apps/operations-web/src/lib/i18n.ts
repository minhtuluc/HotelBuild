/**
 * Danh mục câu chữ của Operations Web: mở rộng danh mục dùng chung.
 * Nội bộ hiển thị nhãn tiếng Việt kèm mã enum (§7.4).
 */
import { makeTranslate, viCatalog } from '@pinehill/ui-web/messages';

export const operationsCatalog = {
  ...viCatalog,
  'ops.home.title': 'Pine Hill — Bảng điều khiển vận hành',
  'ops.home.intro':
    'Khung back-office F0: dùng chung hợp đồng trạng thái, token và định dạng vi-VN với web khách.',
  'ops.home.states': 'Bộ trạng thái UI dùng chung',
  'ops.home.openState': 'Mở trạng thái',
  'ops.demo.only': 'Khung F0 — chưa nối API nghiệp vụ; phân quyền theo vai trò thuộc F1.',
} as const;

export type OperationsMessageKey = keyof typeof operationsCatalog;

export const t = makeTranslate(operationsCatalog);
