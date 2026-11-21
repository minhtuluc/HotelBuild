/**
 * HB-274 — theme vận hành dùng chung của hệ "vé tàu" (`@pinehill/ui-native`, HB-272): nền làm việc, header
 * bảng ga, nút chính mực xanh, tiêu đề chữ thân (như operations web). Giữ tên khoá cũ để mọi màn đổi giao
 * diện không phải sửa.
 */
import { createTheme } from '@pinehill/ui-native';

export const { theme, stackScreenOptions } = createTheme('ops');
