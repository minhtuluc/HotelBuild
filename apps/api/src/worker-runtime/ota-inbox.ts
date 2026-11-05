/**
 * Composition runtime cho worker (seam HB-127, dùng bởi HB-129 AC13).
 *
 * Worker có **một** client Prisma và một `Clock`; factory này dựng use case áp inbox mà **không** khởi
 * động Nest/HTTP và **không** đọc `process.env`. Nhờ vậy worker gọi đúng một cài đặt transaction áp
 * booking (không chép lại), chỉ khác nguồn `clock`/`ids` của tiến trình.
 *
 * Đường dẫn xuất khẩu công khai: `@pinehill/api/worker-runtime/ota-inbox.js` (điều kiện
 * `pinehill-dist` → `dist/`, mặc định → `src/` cho typecheck/dev).
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { AuditWriter } from '../infrastructure/audit/audit-writer.js';
import { createOtaInboxApplier } from '../modules/chan/inbound/index.js';
import type { OtaInboxApplier } from '../modules/chan/inbound/index.js';

export interface OtaInboxRuntimeDeps {
  readonly db: PrismaClient;
  readonly clock: Clock;
  /** Vắng thì dùng UUID v4 của tiến trình — worker không cần thêm port DI. */
  readonly ids?: IdGenerator;
}

export function createOtaInboxRuntime(deps: OtaInboxRuntimeDeps): OtaInboxApplier {
  const ids: IdGenerator = deps.ids ?? { generate: () => randomUUID() };
  return createOtaInboxApplier({
    db: deps.db,
    clock: deps.clock,
    ids,
    audit: new AuditWriter(deps.clock),
  });
}

export type { OtaApplyResult, OtaInboxApplier } from '../modules/chan/inbound/index.js';
