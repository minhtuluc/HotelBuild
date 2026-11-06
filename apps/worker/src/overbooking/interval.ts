/**
 * Nhịp quét quá tải đọc từ SystemSetting (`job.overbooking.scanIntervalMinutes`, BR-OVER-05/BR-SYS-02).
 *
 * Đơn vị là **phút** (mặc định 60 ⇒ 3.600.000 ms). Giá trị thiếu/sai/ngoài khoảng không bao giờ biến
 * thành vòng lặp 0 hay nhịp 300 giây của channel-sync: rơi về 60 phút và nói rõ nguồn là `FALLBACK`.
 * Seed khoá này thuộc HB-018; fallback chỉ để worker không chết, không thay nghĩa vụ seed.
 */
import type { PrismaClient } from '@prisma/client';

export const SCAN_INTERVAL_KEY = 'job.overbooking.scanIntervalMinutes';
export const DEFAULT_SCAN_INTERVAL_MINUTES = 60;
/** Trần 24 giờ: quét thưa hơn một ngày thì ranh giới T−24h không còn được bảo vệ. */
export const MAX_SCAN_INTERVAL_MINUTES = 1440;

export interface ScanInterval {
  readonly minutes: number;
  readonly source: 'SETTING' | 'FALLBACK';
}

export const FALLBACK_INTERVAL: ScanInterval = {
  minutes: DEFAULT_SCAN_INTERVAL_MINUTES,
  source: 'FALLBACK',
};

/** Số nguyên dương viết thập phân thuần (không `1e2`, `0x3c`, `60.5`, khoảng trắng chen giữa). */
export function parseScanIntervalMinutes(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (!/^[1-9][0-9]{0,3}$/.test(text)) return null;
  const minutes = Number(text);
  return minutes <= MAX_SCAN_INTERVAL_MINUTES ? minutes : null;
}

export const scanIntervalMs = (minutes: number): number => minutes * 60_000;

export async function readScanInterval(
  db: Pick<PrismaClient, 'system_settings'>,
): Promise<ScanInterval> {
  const row = await db.system_settings.findUnique({
    where: { key: SCAN_INTERVAL_KEY },
    select: { value: true },
  });
  const minutes = parseScanIntervalMinutes(row?.value);
  return minutes === null ? FALLBACK_INTERVAL : { minutes, source: 'SETTING' };
}
