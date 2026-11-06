/**
 * Composition runtime quét quá tải cho worker (HB-127, dùng lại seam của `ota-inbox.ts`).
 *
 * Worker có **một** client Prisma và một `Clock`; factory này trả về đúng use case phát hiện của HB-126
 * (`createOverbookingDetection`) mà **không** khởi động Nest/HTTP và **không** đọc `process.env`. Nhờ đó
 * scan định kỳ, guard F4 và test khoá dùng chung một thuật toán/transaction — worker không có logic
 * booking, tiền hay tồn riêng.
 *
 * Đường dẫn xuất khẩu công khai: `@pinehill/api/worker-runtime/overbooking-scan.js` (điều kiện
 * `pinehill-dist` → `dist/`, mặc định → `src/` cho typecheck/dev).
 */
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { createOverbookingDetection } from '../modules/over/detection/index.js';
import type { OverbookingDetection } from '../modules/over/detection/index.js';

export interface OverbookingScanRuntimeDeps {
  readonly db: PrismaClient;
  readonly clock: Clock;
}

export function createOverbookingScanRuntime(
  deps: OverbookingScanRuntimeDeps,
): OverbookingDetection {
  return createOverbookingDetection({ db: deps.db, clock: deps.clock });
}

export type {
  OverbookingDetection,
  ScanOutcome,
  ScanResult,
} from '../modules/over/detection/index.js';
