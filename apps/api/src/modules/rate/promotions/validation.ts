/**
 * HB-236 — chuẩn hoá lệnh khuyến mãi (UC-RATE-04, BR-RATE-10/11/13).
 *
 * Hợp đồng gửi `validFrom`/`validTo` dạng thời điểm UTC (form SCR-29 đổi `datetime-local` theo giờ trình
 * duyệt). Cột CSDL là `date`, engine giá coi `valid_to` **bao gồm cả ngày** (loader HB-052). Vì vậy máy
 * chủ đổi thời điểm về **ngày nghiệp vụ giờ Việt Nam** rồi mới lưu; giờ/phút trong ngày không được giữ.
 */
import {
  promotionCreateRequestSchema,
  promotionQuerySchema,
  type PromotionQuery,
} from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { invalid, uuid } from '../calendar/support.js';

/** Mã loại phòng được phép trong `room_type_scope` (CHECK `ck_promotions_room_types`). */
export const ROOM_TYPE_CODES = ['STD', 'SUP', 'DLX', 'FAM', 'DOR'] as const;
const CODE = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;
const VN_OFFSET_MS = 7 * 3_600_000;
/** `numeric(12,2)`: phần nguyên tối đa 10 chữ số. */
const MAX_VALUE = 9_999_999_999;

export interface PromotionCreateInput {
  readonly code: string;
  readonly type: 'PERCENT' | 'AMOUNT';
  readonly value: number;
  readonly minNights: number;
  readonly channelScope: readonly string[];
  readonly roomTypeScope: readonly string[];
  /** Ngày nghiệp vụ VN `YYYY-MM-DD`, bao gồm cả hai đầu. */
  readonly validFrom: string;
  readonly validTo: string;
  readonly maxUses: number | null;
  readonly stackable: boolean;
}

interface Issue {
  readonly field: string;
  readonly issue: string;
}

/** Lỗi nghiệp vụ của khuyến mãi theo OpenAPI (`422 E_RATE_PROMO_INVALID`) kèm từng trường sai. */
export function promotionInvalid(details: readonly Issue[]): never {
  throw new AppError(
    422,
    'E_RATE_PROMO_INVALID',
    'Khuyến mãi không hợp lệ.',
    undefined,
    details.map((detail) => ({ ...detail })),
  );
}

/** Thời điểm UTC → ngày dân sự giờ Việt Nam. */
export function vnBusinessDate(instant: string): string {
  return new Date(Date.parse(instant) + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export function listQuery(value: unknown): PromotionQuery {
  const parsed = promotionQuerySchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const { propertyId, cursor } = parsed.data;
  return {
    ...parsed.data,
    ...(propertyId === undefined ? {} : { propertyId: uuid(propertyId) }),
    ...(cursor === undefined ? {} : { cursor: uuid(cursor) }),
  };
}

function issuesOf(input: PromotionCreateInput): Issue[] {
  const issues: Issue[] = [];
  if (!CODE.test(input.code)) issues.push({ field: 'code', issue: 'FORMAT' });
  // BR-RATE-10: PERCENT là phần trăm (CHECK ≤ 100); AMOUNT là VND nguyên.
  if (input.type === 'PERCENT' && input.value > 100)
    issues.push({ field: 'value', issue: 'MAX_100' });
  if (input.value > MAX_VALUE) issues.push({ field: 'value', issue: 'TOO_LARGE' });
  if (input.minNights > 32767) issues.push({ field: 'minNights', issue: 'TOO_LARGE' });
  if (new Set(input.channelScope).size !== input.channelScope.length)
    issues.push({ field: 'channelScope', issue: 'DUPLICATE' });
  const codes: readonly string[] = ROOM_TYPE_CODES;
  if (input.roomTypeScope.some((code) => !codes.includes(code)))
    issues.push({ field: 'roomTypeScope', issue: 'UNKNOWN_ROOM_TYPE' });
  if (new Set(input.roomTypeScope).size !== input.roomTypeScope.length)
    issues.push({ field: 'roomTypeScope', issue: 'DUPLICATE' });
  if (input.validTo < input.validFrom) issues.push({ field: 'validTo', issue: 'BEFORE_START' });
  return issues;
}

export function createInput(value: unknown): PromotionCreateInput {
  const parsed = promotionCreateRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const data = parsed.data;
  const input: PromotionCreateInput = {
    code: data.code.trim().toUpperCase(),
    type: data.type,
    value: data.value,
    minNights: data.minNights,
    channelScope: data.channelScope,
    roomTypeScope: data.roomTypeScope.map((code) => code.trim().toUpperCase()),
    validFrom: vnBusinessDate(data.validFrom),
    validTo: vnBusinessDate(data.validTo),
    maxUses: data.maxUses ?? null,
    stackable: data.stackable,
  };
  const issues = issuesOf(input);
  if (issues.length > 0) promotionInvalid(issues);
  return input;
}
