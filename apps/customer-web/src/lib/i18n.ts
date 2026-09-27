/**
 * Danh mục câu chữ của Customer Web: mở rộng danh mục dùng chung, không viết cứng trong component.
 */
import { makeTranslate, viCatalog } from '@pinehill/ui-web/messages';

export const customerCatalog = {
  ...viCatalog,
  'guest.home.title': 'Pine Hill — Đặt phòng trực tiếp',
  'guest.home.intro':
    'Khung màn hình F0: mọi màn hình nghiệp vụ của khách sẽ dùng đúng hợp đồng trạng thái và token này.',
  'guest.home.states': 'Bộ trạng thái UI dùng chung',
  'guest.home.openState': 'Mở trạng thái',
  'guest.demo.only': 'Dữ liệu minh hoạ — chưa gọi API nghiệp vụ (F0).',
} as const;

export type CustomerMessageKey = keyof typeof customerCatalog;

export const t = makeTranslate(customerCatalog);
