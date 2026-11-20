/**
 * `GET /reconciliation/daily` (HB-262, SCR-68, UC-PAY-05): tổng tiền mặt theo **người thu** trong một ngày
 * VN tại cơ sở, cùng phép tính với lệnh chốt (khoản `CASH` `SUCCEEDED` đối chiếu sổ cái HB-093), kèm kết
 * quả chốt nếu đã chốt. Lễ tân chỉ thấy dòng của chính mình; kế toán/quản lý/chủ thấy mọi người thu.
 * Thuần đọc: không khoá, không ghi.
 */
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { reconciliationDailyQuerySchema, reconciliationDailySchema } from '@pinehill/contracts';
import type { ReconciliationCollector, ReconciliationDaily } from '@pinehill/contracts';
import { z } from 'zod';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { BookingLedger } from '../ledger/service.js';
import { forbidden, invalid, missing, outOfScope } from './errors.js';
import { collectorCashReceipts, verifyAndSumWithLedger } from './service.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

const closedSchema = z.object({
  collectorId: z.string(),
  countedCash: z.number(),
  difference: z.number(),
  managerNotified: z.boolean(),
});

/** Người đã thu tiền mặt trong ngày tại cơ sở (cùng điều kiện với lệnh chốt). */
async function cashCollectors(tx: Tx, propertyId: string, businessDate: string): Promise<string[]> {
  const found = await tx.$queryRaw<{ collector: string }[]>`
    SELECT DISTINCT p.created_by::text AS collector
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
     WHERE p.method = 'CASH'
       AND p.status = 'SUCCEEDED'
       AND p.created_by IS NOT NULL
       AND p.type IN ('DEPOSIT', 'BALANCE', 'PENALTY', 'EXTRA_SERVICE', 'RESCHEDULE_FEE')
       AND (p.paid_at AT TIME ZONE ${TIME_ZONE})::date = ${businessDate}::date
       AND b.property_id = ${propertyId}::uuid`;
  return found.map((row) => row.collector);
}

/** Kết quả chốt đã ghi (nhật ký bất biến `RECONCILIATION_DAILY_CLOSED`) theo người thu. */
async function closedRuns(tx: Tx, propertyId: string, businessDate: string) {
  const audits = await tx.audit_logs.findMany({
    where: {
      action: 'RECONCILIATION_DAILY_CLOSED',
      entity_type: 'Property',
      entity_id: propertyId,
      after_json: { path: ['businessDate'], equals: businessDate },
    },
    orderBy: { chain_seq: 'asc' },
    select: { after_json: true, at: true },
  });
  const byCollector = new Map<string, NonNullable<ReconciliationCollector['closed']>>();
  for (const audit of audits) {
    const parsed = closedSchema.safeParse(audit.after_json);
    if (!parsed.success) continue;
    const { collectorId, ...rest } = parsed.data;
    byCollector.set(collectorId, { ...rest, closedAt: audit.at.toISOString() });
  }
  return byCollector;
}

export async function dailySummary(
  db: PrismaClient,
  clock: Clock,
  actor: AuthorizedActor,
  rawQuery: unknown,
): Promise<ReconciliationDaily> {
  const parsed = reconciliationDailyQuerySchema.safeParse(rawQuery);
  if (!parsed.success) throw invalid();
  const { propertyId, businessDate } = parsed.data;
  if (!actor.hasPermission('reconciliation.read')) throw forbidden();
  if (!actor.canActOn(propertyId)) throw outOfScope();
  const ownOnly = !actor.hasPermission('reconciliation.readAll');
  const ledger = new BookingLedger(clock);
  return db.$transaction(
    async (tx) => {
      const property = await tx.properties.findUnique({ where: { id: propertyId } });
      if (property === null) throw missing();
      const closed = await closedRuns(tx, propertyId, businessDate);
      const ids = [
        ...new Set([...(await cashCollectors(tx, propertyId, businessDate)), ...closed.keys()]),
      ]
        .filter((id) => !ownOnly || id === actor.id)
        .sort();
      const users = await tx.users.findMany({
        where: { id: { in: ids } },
        select: { id: true, full_name: true },
      });
      const names = new Map(users.map((user) => [user.id, user.full_name]));
      const collectors: ReconciliationCollector[] = [];
      for (const id of ids) {
        const receipts = await collectorCashReceipts(tx, propertyId, id, businessDate);
        collectors.push({
          collectorId: id,
          collectorName: names.get(id) ?? id,
          cashReceiptCount: receipts.length,
          expectedCash: Number(await verifyAndSumWithLedger(tx, ledger, receipts)),
          closed: closed.get(id) ?? null,
        });
      }
      return reconciliationDailySchema.parse({ propertyId, businessDate, collectors });
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
