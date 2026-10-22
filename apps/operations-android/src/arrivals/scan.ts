/**
 * SCR-57 — quét mã QR booking. Cổng `QrScanner` tách khỏi camera thật: adapter native (xin quyền camera
 * **đúng lúc bấm "Quét mã QR"**, không xin khi mở màn) phải thêm `expo-camera` và chưa nằm trong ticket này.
 * Từ chối quyền, không có máy quét hay huỷ đều **không chặn luồng**: lễ tân vẫn nhập mã vào ô tìm kiếm.
 */
import { parseBookingCodeFromScan } from './model';

export type ScanOutcome =
  | { readonly kind: 'scanned'; readonly payload: string }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'cancelled' };

export interface QrScanner {
  scan(): Promise<ScanOutcome>;
}

/** Mặc định khi bản dựng chưa có adapter camera. */
export const unavailableScanner: QrScanner = { scan: async () => ({ kind: 'unavailable' }) };

export type ScanResolution<T extends { code: string } = { code: string }> =
  | { readonly kind: 'match'; readonly booking: T }
  | { readonly kind: 'noMatch'; readonly code: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'cancelled' };

const squeeze = (value: string): string => value.replaceAll(/[\s-]/g, '').toUpperCase();

/** Chạy máy quét rồi đối chiếu mã với danh sách đến đã tải; không gọi mạng thêm. */
export async function resolveScan<T extends { code: string }>(
  scanner: QrScanner,
  arrivals: readonly T[],
): Promise<ScanResolution<T>> {
  let outcome: ScanOutcome;
  try {
    outcome = await scanner.scan();
  } catch {
    return { kind: 'unavailable' };
  }
  if (outcome.kind !== 'scanned') return { kind: outcome.kind };
  const code = parseBookingCodeFromScan(outcome.payload);
  if (code === null) return { kind: 'invalid' };
  const booking = arrivals.find((row) => squeeze(row.code) === squeeze(code));
  return booking === undefined ? { kind: 'noMatch', code } : { kind: 'match', booking };
}
