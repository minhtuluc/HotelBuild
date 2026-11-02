/**
 * Hợp đồng nội bộ của use case phát hiện quá tải (HB-126). Hình dạng này là Oracle giai đoạn A tại
 * `apps/api/test/over/detection-helpers/contract.ts`; HB-127 gọi lại đúng use case này từ worker.
 */
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { CaseAction, CaseStatus } from './cases.js';

export interface ScanRequest {
  /** Bỏ trống = quét mọi cơ sở ACTIVE. */
  readonly propertyIds?: readonly string[];
}

export interface ScanOutcome {
  readonly caseId: string;
  readonly propertyId: string;
  readonly date: string;
  readonly roomTypeId: string;
  readonly shortageCount: number;
  readonly status: CaseStatus;
  readonly action: CaseAction;
}

export interface ScanResult {
  readonly scannedAt: Date;
  readonly outcomes: readonly ScanOutcome[];
}

export interface DetectionDeps {
  readonly db: PrismaClient;
  readonly clock: Clock;
}

export interface OverbookingDetection {
  scan(request?: ScanRequest): Promise<ScanResult>;
}

/** Phạm vi quét trong transaction tạo booking F4 (D07): chỉ đúng cơ sở/kỳ/loại phòng cần kiểm. */
export interface DetectionScopeLike {
  readonly propertyIds: readonly string[];
  readonly dates?: readonly string[];
  readonly roomTypeId?: string;
}
