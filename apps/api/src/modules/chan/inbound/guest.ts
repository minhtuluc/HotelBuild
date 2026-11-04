/**
 * Danh tính khách của một sự kiện OTA (BR-CRM-01, BR-BOOK-16).
 *
 * SĐT của kênh có thể ở dạng nội địa; mọi so khớp/ghi `guests.phone` dùng dạng canonical
 * `+84XXXXXXXXX` (CHECK của CSDL). Kênh gửi thiếu SĐT vẫn phải giữ được cam kết đã thu tiền, nên hồ sơ
 * khách nhận một số **định danh mờ** sinh từ `(account, providerBookingCode)` — ổn định khi phát lại,
 * không trùng người khác, và được đánh dấu trong `guests.notes` để CRM biết cần bổ sung.
 */
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../../common/app-error.js';
import { normalizePhone } from '../../crm/guests/phone.js';
import type { OtaFailure } from './scope.js';
import { failed } from './scope.js';
import { OTA_CODE } from './codes.js';

type Tx = Prisma.TransactionClient;

/** `+84` + 9 chữ số suy từ hash — cùng khoá cho cùng số, không phụ thuộc đồng hồ. */
export function placeholderPhone(seed: string): string {
  const digest = createHash('sha256').update(seed, 'utf8').digest('hex');
  const digits = (BigInt(`0x${digest.slice(0, 12)}`) % 1_000_000_000n).toString().padStart(9, '0');
  return `+84${digits}`;
}

export function guestPhoneOf(
  raw: string | null | undefined,
  seed: string,
): { readonly phone: string; readonly placeholder: boolean } | OtaFailure {
  if (raw === null || raw === undefined)
    return { phone: placeholderPhone(seed), placeholder: true };
  try {
    return { phone: normalizePhone(raw), placeholder: false };
  } catch (error) {
    if (error instanceof AppError) return failed(OTA_CODE.eventInvalid);
    throw error;
  }
}

export async function resolveGuest(
  tx: Tx,
  input: {
    readonly fullName: string;
    readonly phone: string;
    readonly placeholder: boolean;
    readonly now: Date;
  },
): Promise<string> {
  const inserted = await tx.$queryRaw<
    { id: string }[]
  >`INSERT INTO guests(full_name, phone, notes, created_at, updated_at)
      VALUES(${input.fullName}, ${input.phone},
             ${input.placeholder ? 'OTA event without guest phone' : null},
             ${input.now}, ${input.now})
      ON CONFLICT (phone) WHERE anonymized_at IS NULL DO NOTHING
      RETURNING id`;
  const created = inserted[0];
  if (created !== undefined) return created.id;
  const existing = await tx.guests.findFirstOrThrow({
    where: { phone: input.phone, anonymized_at: null },
    select: { id: true },
  });
  return existing.id;
}
