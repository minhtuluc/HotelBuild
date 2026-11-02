/**
 * Điểm ghép của phát hiện quá tải (HB-126, F6-D07).
 *
 * `createOverbookingDetection` là **use case dùng chung** cho scanner HB-127, guard F4 và test khoá:
 * cùng một thuật toán gộp `(property, ngày VN, roomType)`, cùng ranh giới `T − 24h`, cùng actor
 * `SYSTEM` khi tự đóng. Guard F4 chỉ khác ở chỗ chạy trong transaction tạo booking và không ghi
 * `overbooking_scan_runs` (đó là việc của scheduler HB-127).
 */
import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { detectProperty } from './engine.js';
import { scanProperties } from './runs.js';
import type {
  DetectionDeps,
  DetectionScopeLike,
  OverbookingDetection,
  ScanRequest,
} from './types.js';

export type {
  DetectionDeps,
  DetectionScopeLike,
  OverbookingDetection,
  ScanOutcome,
  ScanRequest,
  ScanResult,
} from './types.js';
export { allowOversell } from './guard.js';
export type { OversellInput } from './guard.js';
export { deadlineOf, detectProperty } from './engine.js';
export type { DetectionOutcome, DetectionScope } from './engine.js';

/** Guard F4: dùng **cùng** use case nhưng không tạo lượt quét, mọi ghi nằm trong `tx` của caller. */
export async function detectInTransaction(
  tx: Prisma.TransactionClient,
  clock: Clock,
  scope: DetectionScopeLike,
): Promise<void> {
  for (const propertyId of scope.propertyIds)
    await detectProperty(tx, clock, propertyId, {
      ...(scope.dates === undefined ? {} : { dates: scope.dates }),
      ...(scope.roomTypeId === undefined ? {} : { roomTypeId: scope.roomTypeId }),
    });
}

export function createOverbookingDetection({ db, clock }: DetectionDeps): OverbookingDetection {
  return {
    scan: (request?: ScanRequest) => scanProperties(db, clock, request?.propertyIds),
  };
}
