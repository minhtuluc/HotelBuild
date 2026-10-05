/**
 * 7 tài khoản dev (một mỗi vai trò) — HB-018 AC2. Mật khẩu chung đọc từ `SEED_DEV_PASSWORD`;
 * chỉ dùng khi `NODE_ENV !== 'production'`. Băm **Argon2id** theo QĐ-03 T1.
 */
import { hash } from '@node-rs/argon2';

export interface DevAccountSeed {
  username: string;
  fullName: string;
  role:
    | 'OWNER'
    | 'MANAGER'
    | 'FRONT_DESK'
    | 'RESERVATION_AGENT'
    | 'ACCOUNTANT'
    | 'HOUSEKEEPING'
    | 'SYSADMIN';
  /** Mã cơ sở trong `propertyScopes`; rỗng = phạm vi toàn chuỗi (OWNER) hoặc không theo cơ sở (SYSADMIN). */
  propertyCodes: readonly string[];
}

/** Phạm vi theo vai trò: FRONT_DESK/HOUSEKEEPING một cơ sở, MANAGER hai cơ sở, OWNER toàn chuỗi. */
export const DEV_ACCOUNTS: readonly DevAccountSeed[] = [
  {
    username: 'owner',
    fullName: 'Chủ chuỗi (dev)',
    role: 'OWNER',
    propertyCodes: ['CS-01', 'CS-02', 'CS-03'],
  },
  {
    username: 'manager',
    fullName: 'Quản lý Đà Lạt + Vũng Tàu (dev)',
    role: 'MANAGER',
    propertyCodes: ['CS-01', 'CS-02'],
  },
  {
    username: 'frontdesk',
    fullName: 'Lễ tân Đà Lạt (dev)',
    role: 'FRONT_DESK',
    propertyCodes: ['CS-01'],
  },
  {
    username: 'housekeeping',
    fullName: 'Buồng phòng Đà Lạt (dev)',
    role: 'HOUSEKEEPING',
    propertyCodes: ['CS-01'],
  },
  {
    username: 'reservation',
    fullName: 'Đặt phòng Vũng Tàu (dev)',
    role: 'RESERVATION_AGENT',
    propertyCodes: ['CS-02'],
  },
  {
    username: 'accountant',
    fullName: 'Kế toán Phan Thiết (dev)',
    role: 'ACCOUNTANT',
    propertyCodes: ['CS-03'],
  },
  {
    username: 'sysadmin',
    fullName: 'Quản trị hệ thống (dev)',
    role: 'SYSADMIN',
    propertyCodes: [],
  },
];

/** Mật khẩu dev: biến môi trường, có mặc định **chỉ** ngoài production (HB-018 AC2). */
export function resolveDevPassword(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SEED_DEV_PASSWORD?.trim();
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (env.NODE_ENV === 'production') {
    throw new Error('SEED_DEV_PASSWORD bắt buộc khi NODE_ENV=production');
  }
  return 'PineHill@Dev2026';
}

/**
 * Băm mật khẩu theo QĐ-03 T1 (Argon2id). Không truyền `algorithm` vì `@node-rs/argon2` mặc định đã là
 * Argon2id, còn `Algorithm` là *ambient const enum* không dùng được khi `verbatimModuleSyntax` bật;
 * hợp đồng thực tế được kiểm bằng tiền tố PHC `$argon2id$` trong test seed.
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}
