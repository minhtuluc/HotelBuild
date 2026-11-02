/**
 * Adapter OTA simulator (HB-120 hợp đồng, HB-128 hiện thực; api.md §5.1, §6.3).
 *
 * Bốn phần, tất cả đều là **dữ liệu đã công bố**, không tự định nghĩa lại:
 * 1. `{channel}` trong URL chỉ ánh xạ `booking|agoda|airbnb` → `OTA_BOOKING|OTA_AGODA|OTA_AIRBNB`.
 * 2. Cấu hình account/khoá đọc từ `system_settings['chan.ota.accounts']`
 *    (`{ "<provider>": [{ keyId, accountId, secret }] }`); account của hàng inbox lấy từ **cấu hình theo
 *    `(provider, keyId)`**, không bao giờ từ payload.
 * 3. Chữ ký `t=<unix>,v1=<hex(hmac_sha256(secret, `${t}.${rawBody}`))>` trên **raw bytes**, so sánh
 *    constant-time sau khi hình dạng header đã qua `otaWebhookSignatureSchema`, cửa sổ ±300 giây.
 * 4. Payload nghiệp vụ chuẩn hoá theo kênh (`channelCode` là `ChannelCode`), băm SHA-256 để dedup.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  otaWebhookEventSchema,
  otaWebhookSignatureSchema,
  type ChannelCode,
  type OtaWebhookEvent,
} from '@pinehill/contracts';
import { z } from 'zod';

/** Khoá `system_settings` của cấu hình adapter (value_type `JSON`). */
export const ADAPTER_CONFIG_KEY = 'chan.ota.accounts';

/** NFR-SEC-05: lệch tối đa 300 giây giữa đồng hồ máy chủ và `t` trong chữ ký. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const PROVIDERS = ['booking', 'agoda', 'airbnb'] as const;

export type OtaProvider = (typeof PROVIDERS)[number];

/** Ánh xạ duy nhất của api.md §5.1 — bằng chứng ở tầng này cho `{channel} → ChannelCode`. */
const CHANNEL_CODES: Readonly<Record<OtaProvider, ChannelCode>> = {
  booking: 'OTA_BOOKING',
  agoda: 'OTA_AGODA',
  airbnb: 'OTA_AIRBNB',
};

export function providerOf(channel: string): OtaProvider | null {
  return PROVIDERS.find((provider) => provider === channel) ?? null;
}

export interface OtaAccount {
  readonly keyId: string;
  readonly accountId: string;
  readonly secret: string;
}

const accountSchema = z.strictObject({
  keyId: z.string().trim().min(1).max(64),
  accountId: z.string().trim().min(1).max(64),
  secret: z.string().min(1),
});

/** Provider không có trong cấu hình là `[]`: kênh đó không mở được khoá nào. */
const accountsSettingSchema = z
  .object({
    booking: z.array(accountSchema).default([]),
    agoda: z.array(accountSchema).default([]),
    airbnb: z.array(accountSchema).default([]),
  })
  .strict();

export type OtaAccounts = z.infer<typeof accountsSettingSchema>;

/**
 * Parse cấu hình adapter. JSON hỏng/sai lược đồ **ném** (lỗi cấu hình phía máy chủ, không phải lỗi
 * chữ ký) để tầng gọi trả `503`; cấu hình hợp lệ nhưng thiếu khoá là `null` ở `findAccount`.
 */
export function parseAccounts(value: string): OtaAccounts {
  const decoded: unknown = JSON.parse(value);
  return accountsSettingSchema.parse(decoded);
}

/** Khoá phải thuộc **đúng provider** của URL: khoá của kênh khác không mở được kênh này. */
export function findAccount(
  accounts: OtaAccounts,
  provider: OtaProvider,
  keyId: string,
): OtaAccount | null {
  return accounts[provider].find((account) => account.keyId === keyId) ?? null;
}

export interface SignatureInput {
  /** Nguyên giá trị `X-Pinehill-Signature`. */
  readonly header: string;
  /** Byte gốc của thân yêu cầu (trước khi Fastify parse). */
  readonly raw: Buffer;
  readonly secret: string;
  readonly nowSeconds: number;
}

/**
 * `true` chỉ khi header đúng hình dạng **và** HMAC khớp **và** `|now − t| ≤ 300`. Hex được kiểm độ dài
 * bởi schema nên hai digest luôn cùng 32 byte; so sánh dùng `timingSafeEqual` (NFR-SEC-05).
 */
export function verifySignature(input: SignatureInput): boolean {
  const header = otaWebhookSignatureSchema.safeParse(input.header);
  if (!header.success) return false;
  const parts = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header.data);
  if (parts?.[1] === undefined || parts[2] === undefined) return false;
  const timestamp = Number(parts[1]);
  if (!Number.isSafeInteger(timestamp)) return false;
  if (Math.abs(input.nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.`)
    .update(input.raw)
    .digest();
  return timingSafeEqual(expected, Buffer.from(parts[2], 'hex'));
}

/**
 * Payload nghiệp vụ đã chuẩn hoá cho `webhook_inbox.payload_json`: giữ đủ trường HB-129 cần, thêm
 * `channelCode` của kênh, chuẩn hoá trường tuỳ chọn thành `null` để JSON ổn định (không `undefined`).
 * Không chứa bí mật HMAC; SĐT/tên khách ở đây là dữ liệu nghiệp vụ của sự kiện, không vào log.
 */
export function normalizeEvent(
  provider: OtaProvider,
  event: OtaWebhookEvent,
): Prisma.InputJsonValue {
  return {
    channelCode: CHANNEL_CODES[provider],
    eventType: event.eventType,
    providerAccountId: event.providerAccountId,
    providerBookingCode: event.providerBookingCode,
    providerUpdatedAt: event.providerUpdatedAt,
    propertyCode: event.propertyCode,
    roomTypeCode: event.roomTypeCode,
    checkIn: event.checkIn,
    checkOut: event.checkOut,
    adults: event.adults,
    children: event.children,
    roomCount: event.roomCount,
    guest: { fullName: event.guest.fullName, phone: event.guest.phone ?? null },
    amount: event.amount,
    currency: event.currency,
    paymentCollected: event.paymentCollected,
    note: event.note ?? null,
  };
}

/** Băm payload đã chuẩn hoá — cùng sự kiện ⇒ cùng hash, nội dung khác ⇒ hash khác (AC6/AC7). */
export function hashPayload(payload: Prisma.InputJsonValue): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

/** Thân phải là JSON **đúng** lược đồ strict HB-120; mọi sai lệch là lỗi người gửi (400). */
export function parseEvent(raw: Buffer): OtaWebhookEvent | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
  const parsed = otaWebhookEventSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
