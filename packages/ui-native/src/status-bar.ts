/**
 * HB-267 — chữ trên thanh trạng thái phải **tối** vì hai app Android luôn dùng giao diện sáng.
 *
 * Edge-to-edge (RN 0.86 / Expo SDK 57) đặt màu chữ trạng thái theo chế độ sáng/tối của **máy** và ghi đè
 * lần đặt ngay lúc mount; trên máy thật để chế độ tối, giờ/pin thành chữ trắng trên nền sáng gần như
 * không đọc được. Đặt `dark-content` ngay và đặt lại sau một nhịp thì giữ được (đã kiểm khi mở lại từ nền
 * và khi chuyển màn).
 *
 * HB-273: app khách có header bảng ga đen nên cần chữ **sáng**; kiểu chữ thành tham số, cùng cơ chế đặt lại.
 */
import { useEffect } from 'react';
import { StatusBar } from 'react-native';

export const STATUS_BAR_REAPPLY_MS = 1500;

export type BarStyle = 'dark-content' | 'light-content';

export interface BarStyleSetter {
  setBarStyle(style: BarStyle, animated: boolean): void;
}

type Schedule = (run: () => void, ms: number) => () => void;

/** Trả hàm huỷ nhịp đặt lại. `schedule` tách ra để test không cần đồng hồ thật. */
export function applyStatusBarStyle(bar: BarStyleSetter, style: BarStyle, schedule: Schedule): () => void {
  bar.setBarStyle(style, false);
  return schedule(() => bar.setBarStyle(style, false), STATUS_BAR_REAPPLY_MS);
}

export function applyDarkStatusBar(bar: BarStyleSetter, schedule: Schedule): () => void {
  return applyStatusBarStyle(bar, 'dark-content', schedule);
}

/** Gọi một lần ở layout gốc của app. */
export function useStatusBarStyle(style: BarStyle): void {
  useEffect(
    () =>
      applyStatusBarStyle(StatusBar, style, (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      }),
    [style],
  );
}

export function useDarkStatusBar(): void {
  useStatusBarStyle('dark-content');
}
