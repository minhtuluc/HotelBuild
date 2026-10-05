/**
 * Seed dữ liệu tham chiếu + 7 tài khoản dev (HB-018).
 *
 * Idempotent: mọi lệnh ghi dùng `ON CONFLICT` theo khoá nghiệp vụ ổn định (`CS-01`, `STD01`, `WEB`,
 * `FLEX7`, `CP-FLEX7`…) nên chạy lại không tạo bản ghi trùng. Giá trị `system_settings` đã có thì
 * **giữ nguyên** (không ghi đè cấu hình vận hành); phần tài khoản dev bị bỏ qua khi `NODE_ENV=production`.
 *
 * Chạy: `pnpm db:seed` (xem `apps/api/package.json`).
 */
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { DEV_ACCOUNTS, hashPassword, resolveDevPassword } from './dev-accounts.js';
import {
  CHANNELS,
  FLOOR_BY_ROOM_TYPE,
  PROPERTIES,
  ROOM_TYPES,
  roomCode,
} from './reference-data.js';
import { CANCELLATION_POLICIES, RATE_PLANS } from './policies.js';
import { SYSTEM_SETTINGS } from './settings.js';

export interface SeedSummary {
  properties: number;
  roomTypes: number;
  rooms: number;
  sellingUnits: number;
  channels: number;
  ratePlans: number;
  policies: number;
  tiers: number;
  settings: number;
  users: number;
}

export interface SeedOptions {
  connectionString: string;
  /** `NODE_ENV` hiệu lực; `production` ⇒ bỏ qua phần tài khoản dev. */
  nodeEnv?: string | undefined;
  dbPassword?: string | undefined;
}

type Queryable = Pick<pg.Client, 'query'>;

/** Nguồn kết nối: ưu tiên URL runtime, nếu không có thì dùng URL migration. */
export function seedConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim() || env.DATABASE_MIGRATION_URL?.trim();
  if (url === undefined || url === '') {
    throw new Error('Cần DATABASE_URL hoặc DATABASE_MIGRATION_URL để seed');
  }
  return url;
}

async function upsertId(db: Queryable, sql: string, params: readonly unknown[]): Promise<string> {
  const result = await db.query<{ id: string }>(sql, [...params]);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('Không lấy được id sau khi ghi');
  return id;
}

/** Cơ sở + loại phòng + phòng vật lý; trả số phòng và đơn vị bán (BR-PROP-03/04). */
async function seedRooms(
  db: Queryable,
): Promise<{ properties: number; roomTypes: number; rooms: number; sellingUnits: number }> {
  const summary = { properties: 0, roomTypes: 0, rooms: 0, sellingUnits: 0 };
  for (const property of PROPERTIES) {
    const propertyId = await upsertId(
      db,
      `INSERT INTO properties (code, name, address, phone, latitude, longitude)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, address = EXCLUDED.address, phone = EXCLUDED.phone,
         latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, updated_at = now()
       RETURNING id`,
      [
        property.code,
        property.name,
        property.address,
        property.phone,
        property.latitude,
        property.longitude,
      ],
    );
    summary.properties += 1;
    for (const type of ROOM_TYPES) {
      const roomTypeId = await upsertId(
        db,
        `INSERT INTO room_types
           (property_id, code, name, capacity_adults, capacity_children, base_price, min_price, max_price, allow_shared)
         VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8)
         ON CONFLICT (property_id, code) DO UPDATE SET
           name = EXCLUDED.name, capacity_adults = EXCLUDED.capacity_adults,
           base_price = EXCLUDED.base_price, min_price = EXCLUDED.min_price,
           max_price = EXCLUDED.max_price, allow_shared = EXCLUDED.allow_shared, updated_at = now()
         RETURNING id`,
        [
          propertyId,
          type.code,
          type.name,
          type.capacityAdults,
          type.basePrice,
          type.minPrice,
          type.maxPrice,
          type.allowShared,
        ],
      );
      summary.roomTypes += 1;
      for (let index = 1; index <= property.rooms[type.code]; index += 1) {
        const code = roomCode(type.code, index);
        await upsertId(
          db,
          `INSERT INTO rooms (property_id, room_type_id, code, name, floor, bed_count)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (property_id, code) DO UPDATE SET
             room_type_id = EXCLUDED.room_type_id, name = EXCLUDED.name,
             floor = EXCLUDED.floor, bed_count = EXCLUDED.bed_count, updated_at = now()
           RETURNING id`,
          [
            propertyId,
            roomTypeId,
            code,
            `${type.name} ${code}`,
            FLOOR_BY_ROOM_TYPE[type.code],
            type.bedCount,
          ],
        );
        summary.rooms += 1;
        summary.sellingUnits += type.code === 'DOR' ? type.bedCount : 1;
      }
    }
  }
  return summary;
}

async function seedChannels(db: Queryable): Promise<number> {
  for (const channel of CHANNELS) {
    await upsertId(
      db,
      `INSERT INTO channels (code, name, multiplier, commission_pct, hold_minutes, overbook_allowed)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, multiplier = EXCLUDED.multiplier,
         commission_pct = EXCLUDED.commission_pct, hold_minutes = EXCLUDED.hold_minutes,
         overbook_allowed = EXCLUDED.overbook_allowed, updated_at = now()
       RETURNING id`,
      [
        channel.code,
        channel.name,
        channel.multiplier,
        channel.commissionPct,
        channel.holdMinutes,
        channel.overbookAllowed,
      ],
    );
  }
  return CHANNELS.length;
}

/** Chính sách huỷ + bậc; trả bản đồ mã chính sách → id để gói giá tham chiếu. */
async function seedPolicies(
  db: Queryable,
): Promise<{ policies: number; tiers: number; policyIdByCode: Map<string, string> }> {
  const policyIdByCode = new Map<string, string>();
  let tiers = 0;
  for (const policy of CANCELLATION_POLICIES) {
    const policyId = await upsertId(
      db,
      `INSERT INTO cancellation_policies
         (code, name, is_default, early_checkout_free_hours, early_checkout_refund_pct)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, is_default = EXCLUDED.is_default,
         early_checkout_free_hours = EXCLUDED.early_checkout_free_hours,
         early_checkout_refund_pct = EXCLUDED.early_checkout_refund_pct, updated_at = now()
       RETURNING id`,
      [
        policy.code,
        policy.name,
        policy.isDefault,
        policy.earlyCheckoutFreeHours,
        policy.earlyCheckoutRefundPct,
      ],
    );
    policyIdByCode.set(policy.code, policyId);
    for (const tier of policy.tiers) {
      await upsertId(
        db,
        `INSERT INTO cancellation_tiers
           (policy_id, offset_hours, refund_percent, charge_first_night, label, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (policy_id, offset_hours) DO UPDATE SET
           refund_percent = EXCLUDED.refund_percent, charge_first_night = EXCLUDED.charge_first_night,
           label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, updated_at = now()
         RETURNING id`,
        [
          policyId,
          tier.offsetHours,
          tier.refundPercent,
          tier.chargeFirstNight,
          tier.label,
          tier.sortOrder,
        ],
      );
      tiers += 1;
    }
  }
  return { policies: CANCELLATION_POLICIES.length, tiers, policyIdByCode };
}

async function seedRatePlans(db: Queryable, policyIdByCode: Map<string, string>): Promise<number> {
  for (const plan of RATE_PLANS) {
    const policyId = policyIdByCode.get(plan.policyCode);
    if (policyId === undefined) throw new Error(`Gói ${plan.code} trỏ chính sách không tồn tại`);
    await upsertId(
      db,
      `INSERT INTO rate_plans
         (code, name, deposit_percent, cancellation_policy_id, min_nights, max_nights,
          los_discount_enabled, reschedule_allowed, reschedule_min_hours, reschedule_fee_pct, max_reschedules)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, deposit_percent = EXCLUDED.deposit_percent,
         cancellation_policy_id = EXCLUDED.cancellation_policy_id, min_nights = EXCLUDED.min_nights,
         max_nights = EXCLUDED.max_nights, los_discount_enabled = EXCLUDED.los_discount_enabled,
         reschedule_allowed = EXCLUDED.reschedule_allowed,
         reschedule_min_hours = EXCLUDED.reschedule_min_hours,
         reschedule_fee_pct = EXCLUDED.reschedule_fee_pct,
         max_reschedules = EXCLUDED.max_reschedules, updated_at = now()
       RETURNING id`,
      [
        plan.code,
        plan.name,
        plan.depositPercent,
        policyId,
        plan.minNights,
        plan.maxNights,
        plan.losDiscountEnabled,
        plan.rescheduleAllowed,
        plan.rescheduleMinHours,
        plan.rescheduleFeePct,
        plan.maxReschedules,
      ],
    );
  }
  return RATE_PLANS.length;
}

/** Giữ giá trị đang vận hành khi chạy lại: chỉ chèn khoá còn thiếu. */
async function seedSettings(db: Queryable): Promise<number> {
  for (const setting of SYSTEM_SETTINGS) {
    await db.query(
      `INSERT INTO system_settings (key, value, value_type, description)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO NOTHING`,
      [setting.key, setting.value, setting.valueType, setting.description],
    );
  }
  return SYSTEM_SETTINGS.length;
}

/** Ghi toàn bộ dữ liệu tham chiếu; trả số lượng để test đếm lại. */
export async function seedReferenceData(db: Queryable): Promise<SeedSummary> {
  const rooms = await seedRooms(db);
  const policy = await seedPolicies(db);
  return {
    ...rooms,
    channels: await seedChannels(db),
    ratePlans: await seedRatePlans(db, policy.policyIdByCode),
    policies: policy.policies,
    tiers: policy.tiers,
    settings: await seedSettings(db),
    users: 0,
  };
}

/** 7 tài khoản dev với phạm vi cơ sở; bỏ qua khi `NODE_ENV=production`. */
export async function seedDevAccounts(db: Queryable, password: string): Promise<number> {
  let created = 0;
  for (const account of DEV_ACCOUNTS) {
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
       VALUES ($1,$2,$3,$4,false)
       ON CONFLICT (username) DO UPDATE SET
         full_name = EXCLUDED.full_name, role = EXCLUDED.role, updated_at = now()`,
      [account.username, await hashPassword(password), account.fullName, account.role],
    );
    const row = await db.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [
      account.username,
    ]);
    const userId = row.rows[0]?.id;
    if (userId === undefined) throw new Error(`Thiếu tài khoản dev ${account.username}`);
    for (const propertyCode of account.propertyCodes) {
      await db.query(
        `INSERT INTO user_property_scopes (user_id, property_id)
         SELECT $1, p.id FROM properties p WHERE p.code = $2
         ON CONFLICT (user_id, property_id) DO NOTHING`,
        [userId, propertyCode],
      );
    }
    created += 1;
  }
  return created;
}

export async function runSeed(options: SeedOptions): Promise<SeedSummary> {
  const client = new pg.Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    const summary = await seedReferenceData(client);
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
    if (nodeEnv === 'production') {
      process.stdout.write('NODE_ENV=production: bỏ qua phần tài khoản dev (HB-018 AC2)\n');
      summary.users = 0;
    } else {
      summary.users = await seedDevAccounts(client, options.dbPassword ?? resolveDevPassword());
    }
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/** Điểm vào của `pnpm db:seed`; tách để test gọi trực tiếp và mã này được phủ. */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<SeedSummary> {
  const summary = await runSeed({
    connectionString: seedConnectionString(env),
    nodeEnv: env.NODE_ENV,
  });
  process.stdout.write(`Seed xong: ${JSON.stringify(summary)}\n`);
  return summary;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Seed thất bại');
    process.exitCode = 1;
  });
}
