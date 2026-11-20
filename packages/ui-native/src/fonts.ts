/**
 * HB-272 — font thương hiệu đóng gói offline (OFL, giống web): Be Vietnam Pro và Barlow Condensed.
 * Lối riêng `@pinehill/ui-native/fonts`: các module dưới đây nhập tệp `.ttf`, nên **không** export từ
 * `index.ts` (vitest của app chạy trong node sẽ không nạp được). Nhập theo đường dẫn từng độ đậm để Metro
 * chỉ đóng gói 6 tệp đang dùng.
 */
import { useFonts } from 'expo-font';
import { BeVietnamPro_400Regular } from '@expo-google-fonts/be-vietnam-pro/400Regular';
import { BeVietnamPro_500Medium } from '@expo-google-fonts/be-vietnam-pro/500Medium';
import { BeVietnamPro_600SemiBold } from '@expo-google-fonts/be-vietnam-pro/600SemiBold';
import { BeVietnamPro_700Bold } from '@expo-google-fonts/be-vietnam-pro/700Bold';
import { BarlowCondensed_500Medium } from '@expo-google-fonts/barlow-condensed/500Medium';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { fontFamily } from './tokens.js';

/** Tên họ chữ (khớp `fontFamily`) → module tệp font. */
export const fontAssets: Readonly<Record<(typeof fontFamily)[keyof typeof fontFamily], number>> = {
  [fontFamily.sans]: BeVietnamPro_400Regular,
  [fontFamily.sansMedium]: BeVietnamPro_500Medium,
  [fontFamily.sansSemiBold]: BeVietnamPro_600SemiBold,
  [fontFamily.sansBold]: BeVietnamPro_700Bold,
  [fontFamily.display]: BarlowCondensed_500Medium,
  [fontFamily.displaySemiBold]: BarlowCondensed_600SemiBold,
};

/**
 * Nạp font thương hiệu. Trả `true` khi đã nạp **hoặc** nạp lỗi: lỗi thì vẫn render bằng font hệ thống,
 * không chặn màn. Font là asset cục bộ nên thời gian chờ chỉ vài trăm ms.
 */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts(fontAssets);
  return loaded || error !== null;
}
