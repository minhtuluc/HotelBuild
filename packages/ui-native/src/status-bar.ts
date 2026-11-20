/**
 * HB-267 — chữ trên thanh trạng thái phải **tối** vì hai app Android luôn dùng giao diện sáng.
 *
 * Edge-to-edge (RN 0.86 / Expo SDK 57) đặt màu chữ trạng thái theo chế độ sáng/tối của **máy** và ghi đè
 * lần đặt ngay lúc mount; trên máy thật để chế độ tối, giờ/pin thành chữ trắng trên nền sáng gần như
 * không đọc được. Đặt `dark-content` ngay và đặt lại sau một nhịp thì giữ được (đã kiểm khi mở lại từ nền
 * và khi chuyển màn).
 */
import { useEffect } from 'react';
import { StatusBar } from 'react-native';

export const STATUS_BAR_REAPPLY_MS = 1500;

export interface BarStyleSetter {
  setBarStyle(style: 'dark-content', animated: boolean): void;
}

/** Trả hàm huỷ nhịp đặt lại. `schedule` tách ra để test không cần đồng hồ thật. */
export function applyDarkStatusBar(
  bar: BarStyleSetter,
  schedule: (run: () => void, ms: number) => () => void,
): () => void {
  bar.setBarStyle('dark-content', false);
  return schedule(() => bar.setBarStyle('dark-content', false), STATUS_BAR_REAPPLY_MS);
}

/** Gọi một lần ở layout gốc của app. */
export function useDarkStatusBar(): void {
  useEffect(
    () =>
      applyDarkStatusBar(StatusBar, (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      }),
    [],
  );
}
