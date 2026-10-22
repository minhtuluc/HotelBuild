/**
 * HB-182 — danh mục cảnh báo vận hành nghiệp vụ (NFR-OBS-04, BR-INV-03, BR-CHAN-07, BR-RBAC-06,
 * BR-CANCEL-12; kien-truc.md §9.4).
 *
 * Đây là **nguồn duy nhất** của danh mục: API chỉ đọc các vết `ALERT_RAISED` mà handler này ghi
 * (`apps/api/src/modules/sys/alerts/`) nên không có bản sao thứ hai để lệch.
 *
 * Ngưỡng đọc từ `system_settings` mỗi lượt quét (đổi tham số có hiệu lực ngay, không cần khởi động lại);
 * khoá thiếu/sai kiểu/rơi ngoài miền thì dùng mặc định dưới đây — không bao giờ ném vì một tham số hỏng.
 */
import type { PrismaClient } from '@prisma/client';

/** Đích nhận: kênh kỹ thuật, MANAGER hoặc OWNER (kien-truc.md §9.4). */
export type AlertTarget = 'technical' | 'MANAGER' | 'OWNER';

export type AlertCondition =
  | 'ROOM_ASSIGNMENT_CONFLICT'
  | 'INVENTORY_OVERBOOKED'
  | 'CHANNEL_DEGRADED'
  | 'ABNORMAL_LOGIN'
  | 'REFUND_OVER_SLA';

/** Khoá `system_settings` số nguyên (ngưỡng + cửa sổ chống trùng) và mặc định khi chưa có hàng. */
export const ALERT_NUMBER_DEFAULTS = {
  'alerts.inventory.overbookThreshold': 0,
  'alerts.channel.failureThreshold': 3,
  'alerts.auth.failedLoginThreshold': 5,
  'alerts.refund.slaDays': 7,
  'alerts.roomConflict.dedupSeconds': 3600,
  'alerts.inventory.dedupSeconds': 3600,
  'alerts.channel.dedupSeconds': 300,
  'alerts.auth.dedupSeconds': 900,
  'alerts.refund.dedupSeconds': 86400,
} as const;

/** Khoá `system_settings` dạng chuỗi (địa chỉ nhận, bề mặt đăng nhập hợp lệ). */
export const ALERT_TEXT_DEFAULTS = {
  'alerts.auth.allowedSurfaces': 'OPS_WEB,ANDROID',
  'alerts.recipient.technical': 'ops@pinehill.local',
  'alerts.recipient.manager': 'manager@pinehill.local',
  'alerts.recipient.owner': 'owner@pinehill.local',
} as const;

export type NumberSettingKey = keyof typeof ALERT_NUMBER_DEFAULTS;
export type TextSettingKey = keyof typeof ALERT_TEXT_DEFAULTS;

export interface AlertConditionSpec {
  readonly condition: AlertCondition;
  /** Mẫu thông báo (`notifications.template`); tiêu đề thư do `noti/message.ts` dựng theo mẫu. */
  readonly template: string;
  readonly targets: readonly AlertTarget[];
  /** Khoá ngưỡng/cấu hình của điều kiện (ngoài khoá chống trùng). */
  readonly keys: readonly (NumberSettingKey | TextSettingKey)[];
}

/** Điều kiện → mẫu, đích nhận và khoá ngưỡng. Bảng này là nguồn duy nhất khi quét và khi ghi nhật ký. */
export const ALERT_CONDITIONS: Readonly<Record<AlertCondition, AlertConditionSpec>> = {
  ROOM_ASSIGNMENT_CONFLICT: {
    condition: 'ROOM_ASSIGNMENT_CONFLICT',
    template: 'alert-room-conflict',
    targets: ['technical'],
    keys: [],
  },
  INVENTORY_OVERBOOKED: {
    condition: 'INVENTORY_OVERBOOKED',
    template: 'alert-inventory-overbook',
    targets: ['technical', 'MANAGER'],
    keys: ['alerts.inventory.overbookThreshold'],
  },
  CHANNEL_DEGRADED: {
    condition: 'CHANNEL_DEGRADED',
    template: 'alert-channel-degraded',
    targets: ['MANAGER'],
    keys: ['alerts.channel.failureThreshold'],
  },
  ABNORMAL_LOGIN: {
    condition: 'ABNORMAL_LOGIN',
    template: 'alert-login-abnormal',
    targets: ['technical'],
    keys: ['alerts.auth.failedLoginThreshold', 'alerts.auth.allowedSurfaces'],
  },
  REFUND_OVER_SLA: {
    condition: 'REFUND_OVER_SLA',
    template: 'alert-refund-sla',
    targets: ['OWNER'],
    keys: ['alerts.refund.slaDays'],
  },
};

const DEDUP_KEYS: Readonly<Record<AlertCondition, NumberSettingKey>> = {
  ROOM_ASSIGNMENT_CONFLICT: 'alerts.roomConflict.dedupSeconds',
  INVENTORY_OVERBOOKED: 'alerts.inventory.dedupSeconds',
  CHANNEL_DEGRADED: 'alerts.channel.dedupSeconds',
  ABNORMAL_LOGIN: 'alerts.auth.dedupSeconds',
  REFUND_OVER_SLA: 'alerts.refund.dedupSeconds',
};

const RECIPIENT_KEYS: Readonly<Record<AlertTarget, TextSettingKey>> = {
  technical: 'alerts.recipient.technical',
  MANAGER: 'alerts.recipient.manager',
  OWNER: 'alerts.recipient.owner',
};

/** Khoá chống trùng trên Redis: một sự cố (điều kiện + đối tượng) ⇒ đúng một cảnh báo mỗi cửa sổ. */
export function dedupKey(condition: AlertCondition, subject: string): string {
  return `alert-dedup:${condition}:${subject}`;
}

/** Tham số đã chốt của một lượt quét (đọc một lần, dùng cho cả lượt). */
export class AlertSettings {
  constructor(private readonly values: ReadonlyMap<string, string>) {}

  /** Số nguyên ≥ `minimum`; thiếu, sai kiểu hoặc dưới miền ⇒ mặc định. */
  number(key: NumberSettingKey, minimum = 0): number {
    const raw = this.values.get(key);
    if (raw === undefined) return ALERT_NUMBER_DEFAULTS[key];
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : ALERT_NUMBER_DEFAULTS[key];
  }

  text(key: TextSettingKey): string {
    const raw = this.values.get(key);
    return raw === undefined || raw.trim() === '' ? ALERT_TEXT_DEFAULTS[key] : raw.trim();
  }

  recipient(target: AlertTarget): string {
    return this.text(RECIPIENT_KEYS[target]);
  }

  dedupSeconds(condition: AlertCondition): number {
    return this.number(DEDUP_KEYS[condition], 1);
  }

  /** Bề mặt đăng nhập hợp lệ (so không phân biệt hoa thường với `clientSurface` trong nhật ký). */
  allowedSurfaces(): readonly string[] {
    return this.text('alerts.auth.allowedSurfaces')
      .split(',')
      .map((surface) => surface.trim().toUpperCase())
      .filter((surface) => surface.length > 0);
  }
}

/** Đọc **một** câu cho mọi khoá; hàng thiếu giữ mặc định ở trên. */
export async function loadAlertSettings(db: PrismaClient): Promise<AlertSettings> {
  const keys = [...Object.keys(ALERT_NUMBER_DEFAULTS), ...Object.keys(ALERT_TEXT_DEFAULTS)];
  const rows = await db.$queryRaw<{ key: string; value: string }[]>`
    SELECT key, value FROM system_settings WHERE key = ANY(${keys}::text[])`;
  return new AlertSettings(new Map(rows.map((row) => [row.key, row.value])));
}
