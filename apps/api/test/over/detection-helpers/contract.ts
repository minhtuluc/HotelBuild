/**
 * Hợp đồng khoá HB-126 (giai đoạn A) cho **phát hiện quá tải** và **đường đọc ca**.
 *
 * Đây là Oracle: mọi tên trường/kiểu dưới đây là phần giai đoạn B **phải** trả ra. Nguồn:
 * `docs/04-thiet-ke/api.md` §3.9, `docs/02-nghiep-vu/qua-tai-ghep-doi-phong.md` §5/§7.4,
 * F6-D07 (tự đóng ca + actor `SYSTEM`) và `HB-120` AC5/AC12 (đủ bốn bậc, ứng viên có nhóm ưu tiên,
 * metadata lần quét).
 *
 * Quy ước đã pin:
 * - `date` là ngày thiếu phòng theo **giờ VN** (`YYYY-MM-DD`); `resolveDeadline = T − 24h` với
 *   `T = property.check_in_time` (14:00 VN mặc định).
 * - `priorityGroup = 'WEAK'` là nhóm vi phạm BR-OVER-12 (`WALKIN` chưa trả tiền, `HELD`); nhóm này
 *   **luôn đứng trước** `'STRONG'`. Trong mỗi nhóm: `keepScore` ↑ → `createdAt` ↓ → `bookingSeq` ↑.
 * - `affectedBookingIds` là `shortageCount` ứng viên đầu tiên theo đúng thứ tự trên.
 * - `resolutionSource = 'SYSTEM'` chỉ dùng cho lần tự đóng của worker với `resolvedBy = null`
 *   (F6-D07); ca do người xử lý có `resolutionSource = 'USER'` và `resolvedBy` là người thật.
 * - danh sách sắp theo `date` ↑ rồi `id` ↑ (khoá ổn định, cursor không chứa thông tin cấp quyền).
 * - `meta.scan` phân biệt **chưa quét** (`NEVER`), **đang chạy** (`RUNNING`), **lượt gần nhất lỗi**
 *   (`FAILED`) và **đã quét thành công** (`SUCCEEDED`); `dataAsOf`/`lastSuccessAt` chỉ đổi sau lượt
 *   thành công nên response không bao giờ biến "chưa biết" thành "0 ca".
 *
 * Use case dùng chung cho scanner (HB-127) và đường nhận booking (D07) nằm ở
 * `apps/api/src/modules/over/detection/index.ts` và phải xuất `createOverbookingDetection`.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { businessDateSchema, isoUtcTimestampSchema } from '@pinehill/contracts';

export const caseStatusSchema = z.enum(['OPEN', 'PROPOSED', 'RESOLVED', 'ESCALATED']);
export type CaseStatus = z.infer<typeof caseStatusSchema>;
export const resolutionSourceSchema = z.enum(['USER', 'SYSTEM']);

export const LADDER_ORDER = [
  'SAME_TYPE_SAME_PROPERTY',
  'UPGRADE_SAME_PROPERTY',
  'SAME_TYPE_CROSS_PROPERTY',
  'WALK_OUT',
] as const;

export const ladderRungSchema = z.object({
  moveType: z.enum(LADDER_ORDER),
  feasible: z.boolean(),
  candidateCount: z.number().int().nonnegative(),
  /** Lý do bậc không khả dụng (bậc 3: các cơ sở cách nhau 160–300 km > 15 km). */
  note: z.string().min(1).optional(),
});

export const candidateSchema = z.object({
  bookingId: z.uuid(),
  bookingRoomId: z.uuid(),
  priorityGroup: z.enum(['WEAK', 'STRONG']),
  keepScore: z.number().int().nonnegative(),
  keepScoreBreakdown: z.object({
    loyalty: z.number().int().nonnegative(),
    payment: z.number().int().nonnegative(),
    nights: z.number().int().nonnegative(),
    repeat: z.number().int().nonnegative(),
    arrived: z.number().int().nonnegative(),
  }),
  createdAt: isoUtcTimestampSchema,
  /** `Booking.seq` là bigint nên đi qua transport dạng chuỗi thập phân (HB-120 AC3). */
  bookingSeq: z.string().regex(/^\d+$/),
});
export type Candidate = z.infer<typeof candidateSchema>;

export const caseSummarySchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  date: businessDateSchema,
  roomTypeId: z.uuid(),
  shortageCount: z.number().int().positive(),
  status: caseStatusSchema,
  detectedAt: isoUtcTimestampSchema,
  resolveDeadline: isoUtcTimestampSchema,
  overdue: z.boolean(),
  resolvedAt: isoUtcTimestampSchema.nullable(),
  resolvedBy: z.uuid().nullable(),
  resolutionSource: resolutionSourceSchema.nullable(),
  delayReason: z.string().nullable(),
  affectedBookingIds: z.array(z.uuid()),
  ladderPreview: z.array(ladderRungSchema).length(4),
});
export type CaseSummary = z.infer<typeof caseSummarySchema>;

export const caseDetailSchema = caseSummarySchema.extend({
  /** Chỉ có khi `includeCandidates=true` (api.md §2.8). */
  candidates: z.array(candidateSchema).optional(),
});
export type CaseDetail = z.infer<typeof caseDetailSchema>;

export const scanMetaSchema = z.object({
  status: z.enum(['NEVER', 'RUNNING', 'FAILED', 'SUCCEEDED']),
  lastSuccessAt: isoUtcTimestampSchema.nullable(),
  dataAsOf: isoUtcTimestampSchema.nullable(),
});

export const caseListSchema = z.object({
  data: z.array(caseSummarySchema),
  meta: z.object({
    limit: z.number().int().positive(),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    overdueCount: z.number().int().nonnegative(),
    scan: scanMetaSchema,
  }),
});
export type CaseList = z.infer<typeof caseListSchema>;

/** Projection tối thiểu cho FRONT_DESK: booking cần xử lý, ngày, nhãn cảnh báo, liên kết được phép. */
export const alertItemSchema = z.strictObject({
  caseId: z.uuid(),
  bookingId: z.uuid(),
  propertyId: z.uuid(),
  roomTypeId: z.uuid(),
  date: businessDateSchema,
  status: z.enum(['OPEN', 'PROPOSED', 'ESCALATED']),
  overdue: z.boolean(),
  label: z.string().min(1),
  deepLink: z.string().startsWith('/'),
});
export type AlertItem = z.infer<typeof alertItemSchema>;

export const alertListSchema = z.object({
  data: z.array(alertItemSchema),
  meta: z.object({
    limit: z.number().int().positive(),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
});

/** Khoá không bao giờ được xuất hiện trong projection cảnh báo của lễ tân. */
export const FORBIDDEN_ALERT_KEYS = [
  'rank',
  'keepScore',
  'keepScoreBreakdown',
  'candidates',
  'affectedBookingIds',
  'guest',
  'guestName',
  'guestPhone',
  'phone',
  'ladderPreview',
] as const;

export const scanOutcomeSchema = z.object({
  caseId: z.uuid(),
  propertyId: z.uuid(),
  date: businessDateSchema,
  roomTypeId: z.uuid(),
  shortageCount: z.number().int().nonnegative(),
  status: caseStatusSchema,
  action: z.enum(['CREATED', 'UPDATED', 'ESCALATED', 'AUTO_RESOLVED', 'UNCHANGED']),
});
export type ScanOutcome = z.infer<typeof scanOutcomeSchema>;

export const scanResultSchema = z.object({
  scannedAt: z.date(),
  outcomes: z.array(scanOutcomeSchema),
});
export type ScanResult = z.infer<typeof scanResultSchema>;

export interface ScanRequest {
  /** Bỏ trống = quét mọi cơ sở ACTIVE. */
  readonly propertyIds?: readonly string[];
}

/** Cổng dùng chung: scanner HB-127 và transaction tạo booking F4 gọi **cùng** use case này. */
export interface OverbookingDetection {
  scan(request?: ScanRequest): Promise<ScanResult>;
}

export interface DetectionDeps {
  readonly db: PrismaClient;
  readonly clock: Clock;
}

export type DetectionFactory = (deps: DetectionDeps) => OverbookingDetection;

/** Đường dẫn hiển thị trong thông điệp đỏ. */
export const DETECTION_PATH = 'apps/api/src/modules/over/detection/index.ts';

/** Specifier dựng động: TypeScript không phân giải tĩnh, giữ test biên dịch được khi B chưa có mã. */
export const DETECTION_SPECIFIER = [
  '..',
  '..',
  'src',
  'modules',
  'over',
  'detection',
  'index.js',
].join('/');
