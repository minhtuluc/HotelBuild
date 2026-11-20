/**
 * HB-273 — theme khách dùng chung của hệ "vé tàu" (`@pinehill/ui-native`, HB-272): nền mẫu biểu, header/tab
 * bảng ga chữ hổ phách, nút chính dấu bấm đỏ. Giữ tên khoá cũ để mọi màn đổi giao diện không phải sửa.
 */
import { createTheme } from '@pinehill/ui-native';

export const { theme, stackScreenOptions, tabScreenOptions } = createTheme('guest');
