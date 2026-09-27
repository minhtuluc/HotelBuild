/**
 * Schema biến môi trường — kiến trúc §7.5 và QT §2: cấu hình validate bằng zod ở biên khởi động,
 * thiếu biến thì dừng tiến trình (NFR-MAIN-05). App đọc `process.env` tại `src/config` rồi parse ở đây.
 */
import { z } from 'zod';

/** Web khách và web vận hành dùng cùng biến; cổng gate phiên bản hợp đồng đọc từ header server. */
export const webEnvSchema = z.strictObject({
  NEXT_PUBLIC_API_BASE_URL: z.string().url('NEXT_PUBLIC_API_BASE_URL phải là URL đầy đủ'),
});

/** Android: base URL công khai và biến thể build (development/preview/production). */
export const mobileEnvSchema = z.strictObject({
  EXPO_PUBLIC_API_BASE_URL: z.string().url('EXPO_PUBLIC_API_BASE_URL phải là URL đầy đủ'),
  EXPO_PUBLIC_APP_VARIANT: z.enum(['development', 'preview', 'production']),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
export type MobileEnv = z.infer<typeof mobileEnvSchema>;
