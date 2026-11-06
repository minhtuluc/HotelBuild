/**
 * Nạp composition runtime quét quá tải của API (`@pinehill/api/worker-runtime/overbooking-scan.js`)
 * mà **không** kéo mã nguồn API vào chương trình TypeScript của worker. Lý do dùng specifier từ biến
 * giống `jobs/ota-inbox/runtime.ts`: typecheck không có điều kiện `pinehill-dist` nên import tĩnh sẽ
 * kéo cả Nest/Fastify vào `tsc` của worker. Worker chỉ cần đúng hình dạng của use case, kiểm lúc chạy.
 */
import type { PrismaClient } from '@prisma/client';

/** Một kết cục của lượt quét — chỉ phần worker cần để đếm/log, khớp `ScanOutcome` của HB-126. */
export interface ScanOutcomeLike {
  readonly action: string;
}

export interface ScanResultLike {
  readonly outcomes: readonly ScanOutcomeLike[];
}

export interface OverbookingScanRuntime {
  scan(): Promise<ScanResultLike>;
}

export interface OverbookingScanRuntimeModule {
  createOverbookingScanRuntime(deps: {
    readonly db: PrismaClient;
    readonly clock: { now(): Date };
  }): OverbookingScanRuntime;
}

const RUNTIME_MODULE = '@pinehill/api/worker-runtime/overbooking-scan.js';

const isFactory = (value: unknown): value is OverbookingScanRuntimeModule =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'createOverbookingScanRuntime') === 'function';

let cached: Promise<OverbookingScanRuntimeModule> | null = null;

export function loadScanRuntime(): Promise<OverbookingScanRuntimeModule> {
  cached ??= (async () => {
    const specifier: string = RUNTIME_MODULE;
    const loaded: unknown = await import(specifier);
    if (!isFactory(loaded)) throw new Error('OVERBOOKING_RUNTIME_MODULE_INVALID');
    return loaded;
  })();
  return cached;
}
