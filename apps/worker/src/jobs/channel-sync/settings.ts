import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_INTERVAL_SECONDS,
  INTERVAL_SETTING_KEY,
  MANAGER_RECIPIENT_SETTING_KEY,
  SIMULATOR_SETTING_KEY,
} from './contract.js';

export interface ChannelSyncSettings {
  /** Địa chỉ adapter OTA (simulator ở dev); vắng ⇒ lượt đồng bộ thất bại thay vì giả vờ thành công. */
  readonly simulatorBaseUrl: string | null;
  /** Đích nhận cảnh báo `DEGRADED`; vắng thì chỉ ghi audit, không bịa địa chỉ. */
  readonly managerRecipient: string | null;
}

/** Cài đặt vận hành của lượt đồng bộ, đọc từ `system_settings` (BR-SYS-02). */
export async function loadChannelSyncSettings(db: PrismaClient): Promise<ChannelSyncSettings> {
  const rows = await db.$queryRaw<{ key: string; value: string }[]>`
    SELECT key, value FROM system_settings
     WHERE key = ANY(${[INTERVAL_SETTING_KEY, SIMULATOR_SETTING_KEY, MANAGER_RECIPIENT_SETTING_KEY]}::text[])`;
  const values = new Map(rows.map((row) => [row.key, row.value.trim()] as const));
  const base = values.get(SIMULATOR_SETTING_KEY);
  const recipient = values.get(MANAGER_RECIPIENT_SETTING_KEY);
  return {
    simulatorBaseUrl: base === undefined || base.length === 0 ? null : base,
    managerRecipient: recipient === undefined || recipient.length === 0 ? null : recipient,
  };
}

/**
 * Nhịp quét đọc **lúc khởi động** để đăng ký scheduler theo giá trị hiện hành (`job.channelSync.intervalSeconds`).
 * Dùng kết nối ngắn hạn vì `createWorkerApp` chưa có kết nối nghiệp vụ; lỗi đọc không chặn worker —
 * quay về mặc định 300 giây và lượt quét sau vẫn đọc lại cấu hình.
 */
export async function channelSyncIntervalSeconds(databaseUrl: string): Promise<number> {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return DEFAULT_INTERVAL_SECONDS;
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:')
    return DEFAULT_INTERVAL_SECONDS;
  // Khởi động worker không được treo vì CSDL chậm: chờ tối đa 2 giây rồi dùng nhịp mặc định.
  url.searchParams.set('connect_timeout', '2');
  const db = new PrismaClient({ datasourceUrl: url.href });
  try {
    const rows = await db.$queryRaw<{ value: string }[]>`
      SELECT value FROM system_settings WHERE key = ${INTERVAL_SETTING_KEY}`;
    const parsed = Number.parseInt(rows[0]?.value ?? '', 10);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_INTERVAL_SECONDS;
  } catch {
    return DEFAULT_INTERVAL_SECONDS;
  } finally {
    await db.$disconnect();
  }
}
