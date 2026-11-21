/**
 * HB-278 — thanh ngữ cảnh của màn chính, như thanh dính đầu trang của operations web (DESIGN.md §Layout):
 * cơ sở đang làm việc, giờ VN, vai trò. Tên cơ sở lấy từ danh sách công khai; chưa có thì ghi "Pine Hill",
 * không bao giờ in id cơ sở.
 */
import type { UserRole } from '@pinehill/contracts';
import { t } from './strings';

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  OWNER: 'Chủ chuỗi',
  MANAGER: 'Quản lý',
  FRONT_DESK: 'Lễ tân',
  RESERVATION_AGENT: 'Nhân viên đặt phòng',
  ACCOUNTANT: 'Kế toán',
  HOUSEKEEPING: 'Buồng phòng',
  SYSADMIN: 'Quản trị hệ thống',
};

/** `HH:mm` theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export function vnClock(nowMs: number): string {
  return new Date(nowMs + 7 * 3_600_000).toISOString().slice(11, 16);
}

export function contextRows(input: {
  nowMs: number;
  role: UserRole;
  propertyName: string | null;
}): { title: string; rows: readonly string[] } {
  return {
    title: input.propertyName ?? 'Pine Hill',
    rows: [t('home.context.time', { time: vnClock(input.nowMs) }), ROLE_LABELS[input.role]],
  };
}
