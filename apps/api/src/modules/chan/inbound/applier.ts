/**
 * Cổng `applyEvent` của seam HB-129 — **một** transaction cho mutation nghiệp vụ + audit + outbox +
 * `webhook_inbox.PROCESSED` (AC6). Hàng inbox được chiếm bằng lease/CAS của store HB-095 **trong cùng**
 * transaction: hai worker cạnh tranh không thể cùng commit, worker mất lease không đóng `PROCESSED`.
 *
 * Lỗi ghi ở bất kỳ bước nào ném ra ngoài sau khi transaction rollback — cổng job (worker) quyết định
 * thử lại; lần gọi sau áp đúng một lần vì hàng inbox vẫn chưa `PROCESSED`.
 */
import { Prisma } from '@prisma/client';
import { WebhookInbox } from '../../integrations/inbox/store.js';
import { systemActor } from './actor.js';
import { applyEventPayload } from './business.js';
import { OTA_CODE, OTA_QUARANTINE_ACTION } from './codes.js';
import { loadInboxRow } from './inbox.js';
import type { InboxRecord } from './inbox.js';
import { parsePayload } from './payload.js';
import type { OtaApplyResult, OtaInboxApplier, OtaInboxDeps } from './types.js';

const TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;
const MAX_ATTEMPTS = 4;
const RETRYABLE_SQL = ['40001', '40P01', '55P03', '23P01'];

function retryable(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2002' || error.code === 'P2034') return true;
  return error.code === 'P2010' && RETRYABLE_SQL.includes(String(error.meta?.code));
}

export class OtaInboxApplierImpl implements OtaInboxApplier {
  private readonly inbox: WebhookInbox;

  constructor(private readonly deps: OtaInboxDeps) {
    this.inbox = new WebhookInbox(deps.db, deps.ids);
  }

  async applyEvent(eventId: string): Promise<OtaApplyResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.deps.db.$transaction((tx) => this.apply(tx, eventId), TRANSACTION);
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && retryable(error)) continue;
        throw error;
      }
    }
    throw new Error('OTA inbox apply exhausted its retries');
  }

  private async apply(tx: Prisma.TransactionClient, eventId: string): Promise<OtaApplyResult> {
    const now = this.deps.clock.now();
    const row = await loadInboxRow(tx, eventId);
    if (row === null) return skip(OTA_CODE.unknownEvent);
    if (row.status === 'PROCESSED') return skip(OTA_CODE.alreadyProcessed);
    if (row.status === 'DEAD_LETTER') return skip(OTA_CODE.alreadyTerminal);
    const claimed = await this.inbox.claim(tx, row.id, now);
    if (claimed === null) return skip(OTA_CODE.inProgress);
    const payload = parsePayload(row.payload);
    if (payload === null) return this.quarantine(tx, row, OTA_CODE.eventInvalid, now);
    const outcome = await applyEventPayload(tx, this.deps, row, payload, now);
    if (outcome.kind === 'quarantine') return this.quarantine(tx, row, outcome.reason, now);
    await this.inbox.complete(tx, row.id, now);
    return {
      status: outcome.kind === 'applied' ? 'APPLIED' : 'SKIPPED',
      bookingId: outcome.kind === 'applied' ? outcome.bookingId : null,
      reason: outcome.kind === 'applied' ? null : outcome.reason,
    };
  }

  /** Cách ly **bền**: `DEAD_LETTER` + dấu đối soát `SYSTEM` trên chính hàng inbox (AC11). */
  private async quarantine(
    tx: Prisma.TransactionClient,
    row: InboxRecord,
    reason: string,
    now: Date,
  ): Promise<OtaApplyResult> {
    await this.deps.audit.record(tx, {
      actor: systemActor(row.eventId),
      action: OTA_QUARANTINE_ACTION,
      entityType: 'WebhookInbox',
      entityId: row.id,
      beforeJson: null,
      afterJson: {
        provider: row.provider,
        providerAccountId: row.accountId,
        eventId: row.eventId,
        code: reason,
      },
      reason,
    });
    await this.inbox.settle(tx, row.id, now, { reason, terminal: true });
    return { status: 'QUARANTINED', bookingId: null, reason };
  }
}

function skip(reason: string): OtaApplyResult {
  return { status: 'SKIPPED', bookingId: null, reason };
}
