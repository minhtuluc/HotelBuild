/**
 * Vòng đời lượt quét quá tải (HB-126): `overbooking_scan_runs` là nguồn bền cho AC14.
 *
 * `RUNNING` được commit **trước** khi xử lý để `GET` phân biệt được "đang quét" với kết quả cũ; lỗi
 * đánh dấu `FAILED` ở kết nối riêng nên không bị rollback cùng transaction ca; mốc thành công cũ
 * không bị xoá. Chỉ một lượt `RUNNING` mỗi cơ sở (`uq_overbooking_scan_runs_running`) — lượt thứ hai
 * chờ lượt đang chạy kết thúc rồi quét lại, nhờ vậy hai scan đồng thời không tạo hai ca.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AppError } from '../../../common/app-error.js';
import { detectProperty } from './engine.js';
import type { ScanOutcome, ScanResult } from './types.js';

const RETRY_ATTEMPTS = 200;
const RETRY_DELAY_MS = 25;

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

function uniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function insertRunning(db: PrismaClient, clock: Clock, propertyId: string): Promise<string> {
  const row = await db.overbooking_scan_runs.create({
    data: { property_id: propertyId, status: 'RUNNING', started_at: clock.now() },
    select: { id: true },
  });
  return row.id;
}

/** Chờ lượt đang chạy kết thúc; sau ~10s coi là lượt chết và đánh dấu `FAILED` để mở khoá. */
async function startRun(db: PrismaClient, clock: Clock, propertyId: string): Promise<string> {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await insertRunning(db, clock, propertyId);
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
    }
    const running = await db.overbooking_scan_runs.findFirst({
      where: { property_id: propertyId, status: 'RUNNING' },
      select: { id: true },
    });
    if (running !== null) await delay(RETRY_DELAY_MS);
  }
  await db.overbooking_scan_runs.updateMany({
    where: { property_id: propertyId, status: 'RUNNING' },
    data: {
      status: 'FAILED',
      finished_at: clock.now(),
      duration_ms: 0,
      failure_code: 'SCAN_STALE',
      failure_message: 'Lượt quét trước không kết thúc; đánh dấu lỗi để mở khoá.',
      updated_at: clock.now(),
    },
  });
  return insertRunning(db, clock, propertyId);
}

async function finishRun(
  db: PrismaClient,
  runId: string,
  clock: Clock,
  deadline: number,
  totals: { scanned: number; cases: number },
): Promise<void> {
  await db.overbooking_scan_runs.update({
    where: { id: runId },
    data: {
      status: 'SUCCEEDED',
      finished_at: clock.now(),
      duration_ms: Math.max(0, Date.now() - deadline),
      scanned_count: totals.scanned,
      case_count: totals.cases,
      updated_at: clock.now(),
    },
  });
}

async function failRun(
  db: PrismaClient,
  runId: string,
  clock: Clock,
  deadline: number,
  error: unknown,
): Promise<void> {
  const code = error instanceof AppError ? error.code : 'SCAN_FAILED';
  const message = error instanceof Error ? error.message.slice(0, 500) : 'Lượt quét thất bại';
  await db.overbooking_scan_runs.update({
    where: { id: runId },
    data: {
      status: 'FAILED',
      finished_at: clock.now(),
      duration_ms: Math.max(0, Date.now() - deadline),
      failure_code: code,
      failure_message: message,
      updated_at: clock.now(),
    },
  });
}

export async function scanProperties(
  db: PrismaClient,
  clock: Clock,
  propertyIds?: readonly string[],
): Promise<ScanResult> {
  const now = clock.now();
  const properties = await db.properties.findMany({
    where:
      propertyIds === undefined ? { status: 'ACTIVE' } : { id: { in: [...new Set(propertyIds)] } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const outcomes: ScanOutcome[] = [];
  for (const property of properties) {
    const runId = await startRun(db, clock, property.id);
    const deadline = Date.now();
    try {
      const result = await db.$transaction((tx) => detectProperty(tx, clock, property.id), {
        timeout: 30_000,
      });
      await finishRun(db, runId, clock, deadline, {
        scanned: result.length,
        cases: result.filter((item) => item.action === 'CREATED').length,
      });
      outcomes.push(...result);
    } catch (error) {
      await failRun(db, runId, clock, deadline, error);
      throw error;
    }
  }
  return { scannedAt: now, outcomes };
}
