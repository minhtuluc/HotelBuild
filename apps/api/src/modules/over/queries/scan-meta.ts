/**
 * `meta.scan` của danh sách ca (HB-120 AC14): phân biệt **chưa quét** với **rỗng thật** và không xoá
 * mốc thành công cũ khi lượt sau lỗi. Trạng thái lấy từ `overbooking_scan_runs` — nguồn bền, không
 * suy từ `data.length`.
 */
import type { PrismaClient } from '@prisma/client';

export type ScanStatus = 'NEVER' | 'RUNNING' | 'FAILED' | 'SUCCEEDED';

export interface ScanMeta {
  readonly status: ScanStatus;
  readonly lastSuccessAt: string | null;
  readonly dataAsOf: string | null;
}

export async function scanMeta(
  db: PrismaClient,
  propertyIds: readonly string[] | undefined,
): Promise<ScanMeta> {
  if (propertyIds !== undefined && propertyIds.length === 0)
    return { status: 'NEVER', lastSuccessAt: null, dataAsOf: null };
  const runs = await db.overbooking_scan_runs.findMany({
    where: propertyIds === undefined ? {} : { property_id: { in: [...propertyIds] } },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: { property_id: true, status: true, finished_at: true },
  });
  if (runs.length === 0) return { status: 'NEVER', lastSuccessAt: null, dataAsOf: null };
  const latest = new Map<string, string>();
  for (const run of runs) if (!latest.has(run.property_id)) latest.set(run.property_id, run.status);
  const statuses = [...latest.values()];
  let status: ScanStatus = 'SUCCEEDED';
  if (statuses.includes('RUNNING')) status = 'RUNNING';
  else if (statuses.includes('FAILED')) status = 'FAILED';
  const successes = runs
    .filter((run) => run.status === 'SUCCEEDED' && run.finished_at !== null)
    .map((run) => run.finished_at!.getTime());
  const lastSuccess =
    successes.length === 0 ? null : new Date(Math.max(...successes)).toISOString();
  return { status, lastSuccessAt: lastSuccess, dataAsOf: lastSuccess };
}
