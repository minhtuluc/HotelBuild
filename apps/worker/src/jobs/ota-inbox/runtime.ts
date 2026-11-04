/**
 * Nạp composition runtime của API (`@pinehill/api/worker-runtime/ota-inbox.js`) mà **không** kéo mã
 * nguồn API vào chương trình TypeScript của worker.
 *
 * Vì sao dùng specifier từ biến: gói `@pinehill/api` công bố subpath với điều kiện `pinehill-dist`
 * (tiến trình chạy `node --conditions=pinehill-dist`); ở chế độ typecheck không có điều kiện đó nên
 * `import` tĩnh sẽ trỏ về `apps/api/src/**` và kéo cả Nest/Fastify vào `tsc` của worker (lỗi decorator
 * và augmentation `.actor`). Worker chỉ cần đúng hình dạng của applier, kiểm lúc chạy, nên nạp động
 * rồi kiểm hình dạng — cùng cách hợp đồng giai đoạn A nạp module (`contract.ts`).
 */
import type { PrismaClient } from '@prisma/client';

/** Kết cục áp một hàng inbox — đúng `OtaApplyResult` của `modules/chan/inbound/types.ts`. */
export interface OtaApplyOutcome {
  readonly status: 'APPLIED' | 'SKIPPED' | 'QUARANTINED';
  readonly bookingId: string | null;
  readonly reason: string | null;
}

export interface OtaRuntime {
  applyEvent(eventId: string): Promise<OtaApplyOutcome>;
}

export interface OtaRuntimeModule {
  createOtaInboxRuntime(deps: {
    readonly db: PrismaClient;
    readonly clock: { now(): Date };
  }): OtaRuntime;
}

const RUNTIME_MODULE = '@pinehill/api/worker-runtime/ota-inbox.js';

const isFactory = (value: unknown): value is OtaRuntimeModule =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'createOtaInboxRuntime') === 'function';

let cached: Promise<OtaRuntimeModule> | null = null;

export function loadOtaRuntime(): Promise<OtaRuntimeModule> {
  cached ??= (async () => {
    const specifier: string = RUNTIME_MODULE;
    const loaded: unknown = await import(specifier);
    if (!isFactory(loaded)) throw new Error('OTA_RUNTIME_MODULE_INVALID');
    return loaded;
  })();
  return cached;
}
