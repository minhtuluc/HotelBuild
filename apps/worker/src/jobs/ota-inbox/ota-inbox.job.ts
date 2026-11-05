/**
 * HB-129 AC10/AC13 — tiêu thụ `q.ota-inbox`.
 *
 * Việc áp nghiệp vụ **không** được chép lại ở đây: handler dựng use case qua composition runtime
 * (`@pinehill/api/worker-runtime/ota-inbox.js`), nên worker và API dùng đúng một transaction áp
 * booking (claim lease/CAS nằm trong chính transaction đó, xem `applier.ts` của HB-129).
 *
 * Hợp đồng payload (khoá ở `apps/worker/test/ota-inbox/fixture.ts`):
 * - `{}` — quét mọi hàng đến hạn: `PENDING`/`FAILED` có `available_at <= now`, và `PROCESSING` có
 *   `lease_expires_at <= now`. Hàng `PROCESSING` còn lease **không** bị cướp.
 * - `{ eventId }` — chỉ áp đúng hàng đó.
 *
 * Lỗi tạm thời không ném ra ngoài: hàng inbox là nguồn sự thật, nên handler chốt `FAILED` + lùi
 * `available_at` (hoặc `DEAD_LETTER` ở lượt cuối) ở transaction riêng, giữ nguyên `payload_json`, và
 * chỉ ghi mã ngắn vào `last_error`/log (NFR-SEC-04). Lượt sau quét lại hàng đó.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { JobAttempt, JobHandler } from '../types.js';
import { loadOtaRuntime } from './runtime.js';

/** Nhà cung cấp OTA của simulator (§5.1) — không đụng hàng inbox của nguồn khác (PSP). */
const OTA_PROVIDERS = ['booking', 'agoda', 'airbnb'] as const;

/** Trần một lượt quét: mỗi hàng là một transaction riêng, không giữ một transaction khổng lồ. */
const SCAN_LIMIT = 50;

/** Lùi lượt thử lại của hàng `FAILED` (ms) — ngắn hơn nhịp vận hành, dài hơn một transaction. */
const RETRY_BACKOFF_MS = 30_000;

/** Mã ngắn cho `last_error`; khớp `SHORT_ERROR_CODE` của hợp đồng giai đoạn A. */
const APPLY_FAILED_CODE = 'INBOX_APPLY_FAILED';

const jobData = z.strictObject({ eventId: z.string().trim().min(1).max(128).optional() });

async function dueEvents(db: PrismaClient, now: Date): Promise<string[]> {
  const rows = await db.$queryRaw<{ event_id: string }[]>`
    SELECT event_id
      FROM webhook_inbox
     WHERE provider = ANY(${OTA_PROVIDERS}::text[])
       AND ((status IN ('PENDING', 'FAILED') AND available_at <= ${now})
         OR (status = 'PROCESSING' AND lease_expires_at <= ${now}))
     ORDER BY created_at, id
     LIMIT ${SCAN_LIMIT}`;
  return rows.map((row) => row.event_id);
}

/**
 * Chốt lỗi ở transaction **riêng** (transaction nghiệp vụ đã rollback nên chưa có gì được ghi).
 * Chỉ đụng hàng không còn lease sống: lease của worker khác thì để nguyên cho người đó.
 */
async function recordFailure(
  db: PrismaClient,
  eventId: string,
  attempt: JobAttempt | undefined,
  now: Date,
): Promise<void> {
  // `attempt` vắng khi handler được gọi thẳng (test/CLI) — coi như lượt cuối, đúng docblock JobHandler.
  const terminal = attempt === undefined || attempt.attempt >= attempt.attempts;
  await db.webhook_inbox.updateMany({
    where: {
      event_id: eventId,
      status: { notIn: ['PROCESSED', 'DEAD_LETTER'] },
      OR: [{ lease_expires_at: null }, { lease_expires_at: { lte: now } }],
    },
    data: {
      status: terminal ? 'DEAD_LETTER' : 'FAILED',
      last_error: APPLY_FAILED_CODE,
      attempts: { increment: 1 },
      lease_token: null,
      lease_expires_at: null,
      ...(terminal ? {} : { available_at: new Date(now.getTime() + RETRY_BACKOFF_MS) }),
      updated_at: now,
    },
  });
}

export const otaInboxJob: JobHandler = async (data, context, attempt) => {
  const parsed = jobData.safeParse(data ?? {});
  if (!parsed.success) {
    context.log({
      queue: 'q.ota-inbox',
      msg: 'bỏ qua job sai hình dạng',
      errorCode: 'INBOX_JOB_INVALID',
    });
    return;
  }
  const applier = (await loadOtaRuntime()).createOtaInboxRuntime({
    db: context.db,
    clock: context.clock,
  });
  const now = context.clock.now();
  const events =
    parsed.data.eventId === undefined ? await dueEvents(context.db, now) : [parsed.data.eventId];
  for (const eventId of events) {
    try {
      const result = await applier.applyEvent(eventId);
      context.log({
        queue: 'q.ota-inbox',
        msg: `hàng inbox ${result.status}${result.reason === null ? '' : ` (${result.reason})`}`,
        ...(result.status === 'QUARANTINED'
          ? { errorCode: result.reason ?? APPLY_FAILED_CODE }
          : {}),
      });
    } catch {
      // Thông điệp lỗi thô có thể chứa dữ liệu payload; chỉ chốt mã ngắn rồi để lượt quét sau thử lại.
      await recordFailure(context.db, eventId, attempt, context.clock.now());
      context.log({
        queue: 'q.ota-inbox',
        msg: 'không áp được hàng inbox',
        errorCode: APPLY_FAILED_CODE,
      });
    }
  }
};
