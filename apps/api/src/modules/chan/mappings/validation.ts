import { channelMappingPutRequestSchema } from '@pinehill/contracts';
import { DEFAULT_ALLOTMENT_PCT } from '../sync/projection.js';
import { AppError } from '../../../common/app-error.js';
import { invalid } from '../../sys/settings/validation.js';

/** Ánh xạ đã chuẩn hoá; `externalRatePlanCode`/`status` vắng thì giữ giá trị mặc định của CSDL. */
export interface MappingInput {
  readonly roomTypeId: string;
  readonly providerRoomTypeCode: string;
  readonly allotmentPct: number;
  readonly externalRatePlanCode: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
}

const PRECONDITION_REQUIRED = () =>
  new AppError(
    428,
    'E_GEN_PRECONDITION_REQUIRED',
    'Cần If-Match với version hiện hành của kênh để sửa cấu hình ánh xạ.',
  );

export const versionConflict = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'If-Match không khớp version hiện hành của kênh.');

export const mappingConflict = () =>
  new AppError(
    409,
    'E_PROP_CODE_TAKEN',
    'Mã phòng OTA đã được ánh xạ cho loại phòng khác trong kênh.',
  );

/**
 * `If-Match` của ánh xạ là `version` **hiện hành của kênh** (api.md §1.3): thiếu ⇒ 428, không phải một
 * version số hợp lệ ⇒ 412. Chấp nhận dạng yếu `W/"n"` vì proxy có thể hạ cấp tag.
 */
export function expectedChannelVersion(header: string | undefined): bigint {
  if (header === undefined) throw PRECONDITION_REQUIRED();
  const match = /^(?:W\/)?"(\d{1,19})"$/.exec(header.trim());
  if (match === null) throw versionConflict();
  return BigInt(match[1]!);
}

/** Trường bắt buộc đọc **trước** kiểm scope để giữ đúng thứ tự lỗi đã công bố. */
export function bodyString(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null) throw invalid();
  const found: unknown = Reflect.get(value, field);
  if (typeof found !== 'string' || found.trim().length === 0) throw invalid();
  return found;
}

export function bodyField(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) throw invalid();
  return Reflect.get(value, field);
}

/**
 * `channelMappingPutRequestSchema` (strict) chốt hình dạng; trường lạ bị từ chối (400).
 * `allotmentPct = 0` không phải ánh xạ hợp lệ — muốn ngừng bán thì dùng sales-closure (BR-CHAN-05);
 * BR-CHAN-01 chỉ có nghĩa với 1…100%.
 */
export function mappingInput(value: unknown): MappingInput {
  // Vắng `allotmentPct` ⇒ 80% theo BR-CHAN-01; `0` vẫn bị từ chối vì muốn ngừng bán phải dùng sales-closure.
  const body: Record<string, unknown> = {};
  if (typeof value === 'object' && value !== null)
    for (const [key, item] of Object.entries(value)) body[key] = item;
  body['allotmentPct'] ??= DEFAULT_ALLOTMENT_PCT;
  const parsed = channelMappingPutRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid();
  if (parsed.data.allotmentPct < 1) throw invalid();
  return {
    roomTypeId: parsed.data.roomTypeId.toLowerCase(),
    providerRoomTypeCode: parsed.data.providerRoomTypeCode,
    allotmentPct: parsed.data.allotmentPct,
    externalRatePlanCode: parsed.data.externalRatePlanCode ?? null,
    status: parsed.data.status ?? 'ACTIVE',
  };
}
