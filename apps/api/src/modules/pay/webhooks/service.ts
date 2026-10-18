/**
 * Người nhận webhook PSP (HB-095; api.md §5.2, §5.3; ADR-017 §3–5; BR-PAY-03/09/11).
 *
 * Thứ tự bắt buộc cho **mỗi** callback:
 *   verify chữ ký (constant-time, adapter của `pay/psp` — cùng hợp đồng với `POST /payments/online`) →
 *   ghi `webhook_inbox` (transaction riêng, commit) → xử lý (transaction riêng: khoá sổ tiền, mutation,
 *   audit, `PROCESSED` cùng transaction) → ACK theo cổng.
 * Chữ ký sai thì từ chối và **không** ghi gì; lỗi CSDL khi ghi inbox thì trả mã lỗi để PSP gửi lại,
 * **không** success-ACK. Lỗi CSDL khi áp dụng: sự kiện đã bền, nhưng để PSP retry kéo phát lại nội
 * bộ (đúng mã lỗi chứ không 00), hàng inbox được mở lại thành `FAILED`.
 *
 * Bản phát lại/cùng khoá khác payload: không cộng tiền lần hai (BR-PAY-03) — lặp lại mã ACK của kết
 * cục đã lưu trong `last_error`, payload gốc không bị ghi đè.
 */
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger } from 'nestjs-pino';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { ActorContext } from '../../../common/actor/actor-context.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PAYMENT_GATEWAYS, PaymentGateways } from '../psp/gateways.js';
import type { PspMethod, PspResult } from '../psp/port.js';
import { BookingLedger } from '../ledger/service.js';
import { WEBHOOK_INBOX } from '../../integrations/inbox/module.js';
import { WebhookInbox } from '../../integrations/inbox/store.js';
import {
  ackFor,
  canonicalPayload,
  eventIdentity,
  type CallbackAck,
  type CallbackOutcome,
  type WebhookContext,
} from './contract.js';
import { applyVerifiedEvent } from './apply.js';

interface WebhookLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/** Service không ném ra ngoài HTTP: mọi kết cục đều trở thành ACK theo cổng (ADR-017 §5). */
@Injectable()
export class PspWebhookService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(WEBHOOK_INBOX) private readonly inbox: WebhookInbox,
    @Inject(PAYMENT_GATEWAYS) private readonly gateways: PaymentGateways,
    @Inject(BookingLedger) private readonly ledger: BookingLedger,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectPinoLogger(PspWebhookService.name) private readonly logger: WebhookLogger,
  ) {}

  /** AC1–AC3: nhận callback thô, chặn cấu hình mô phỏng, verify, ghi bền, rồi mới ACK. */
  async receive(method: PspMethod, raw: string, context: WebhookContext): Promise<CallbackAck> {
    // P0/F1 — bộ khoá mô phỏng nằm **công khai trong repo** (`pay/psp/settings.ts`) nên chữ ký không
    // chứng minh được gì: chặn trước cả verify, không ghi inbox, không ghi tiền, `503 E_PSP_NOT_PRODUCTION`.
    if (this.gateways.settings[method].mode !== 'live') {
      this.logger.error(
        { event: 'PSP_NOT_PRODUCTION', provider: method, correlationId: context.correlationId },
        'PSP callback refused while simulation keys are in use',
      );
      return ackFor(method, 'NOT_PRODUCTION');
    }
    const verified: PspResult | null = this.gateways.verify(method, raw);
    if (!verified) return ackFor(method, 'BAD_SIGNATURE');
    const identity = eventIdentity(method, verified);
    const now = this.clock.now();
    let rowId: string;
    let hashMatches = true;
    try {
      const receipt = await this.inbox.receive({
        provider: method,
        providerAccountId: this.gateways.settings[method].merchantCode,
        eventId: identity.eventId,
        payloadHash: identity.payloadHash,
        payloadJson: canonicalPayload(method, verified),
        receivedAt: now,
      });
      rowId = receipt.row.id;
      hashMatches = receipt.hashMatches;
      if (!receipt.created && !hashMatches)
        this.logger.warn(
          {
            event: 'PSP_EVENT_HASH_MISMATCH',
            provider: method,
            eventId: identity.eventId,
            correlationId: context.correlationId,
          },
          'Same event id delivered with a different payload',
        );
    } catch (error) {
      this.logger.error(
        { event: 'PSP_INBOX_WRITE_FAILED', provider: method, correlationId: context.correlationId },
        'Webhook inbox not stored',
      );
      return ackFor(method, 'UNSTORED');
    }
    return this.process(rowId, method, identity, hashMatches, verified, context, now);
  }

  /**
   * `claim` CAS quyết định đường đi: hàng `PENDING`/`FAILED` là **việc còn dở** nên được xử lý ngay
   * (kể cả khi payload lần này khác payload gốc — điều kiện tiên quyết là chữ ký/số tiền/đơn của PSP,
   * không phải hash inbox); chỉ `PROCESSED`/`DEAD_LETTER`/đang giữ lease mới là "đã xử lý" ⇒ lặp ACK cũ.
   * Payload gốc **không** bao giờ bị ghi đè; sai khác payload ghi vào `audit_logs` (P1/F6).
   */
  private async process(
    rowId: string,
    method: PspMethod,
    identity: { readonly eventId: string; readonly payloadHash: string },
    hashMatches: boolean,
    verified: PspResult,
    context: WebhookContext,
    now: Date,
  ): Promise<CallbackAck> {
    try {
      const actor: ActorContext = {
        id: null,
        role: 'SYSTEM',
        ip: context.ip,
        correlationId: context.correlationId,
      };
      const outcome = await this.db.$transaction(async (tx) => {
        const claimed = await this.inbox.claim(tx, rowId, now);
        if (claimed === null) {
          const existing = await tx.webhook_inbox.findUniqueOrThrow({
            where: { id: rowId },
            select: { last_error: true, payload_hash: true },
          });
          const decision = hashMatches ? replayOf(existing.last_error) : 'RECONCILE';
          await recordInboxAudit(tx, this.audit, actor, {
            rowId,
            mismatch: !hashMatches,
            reapplied: false,
            method,
            eventId: identity.eventId,
            verified,
            storedPayloadHash: existing.payload_hash,
            incomingPayloadHash: identity.payloadHash,
            decision,
          });
          return decision;
        }
        const apply = await applyVerifiedEvent(tx, this.ledger, this.audit, {
          method,
          eventId: identity.eventId,
          orderRef: verified.orderRef,
          providerTxnId: verified.providerTxnId,
          amount: verified.amount,
          outcome: verified.outcome,
          paidAt: verified.paidAt,
          now,
          actor,
        });
        if (!hashMatches)
          await recordInboxAudit(tx, this.audit, actor, {
            rowId,
            mismatch: true,
            reapplied: true,
            method,
            eventId: identity.eventId,
            verified,
            storedPayloadHash: claimed.payload_hash,
            incomingPayloadHash: identity.payloadHash,
            decision: apply.decision,
          });
        if (apply.note) await this.inbox.settle(tx, rowId, now, apply.note);
        else await this.inbox.complete(tx, rowId, now);
        return apply.decision;
      });
      this.trace(outcome, method, verified, context);
      return ackFor(method, outcome);
    } catch {
      // Transaction nghiệp vụ rollback (kể cả claim) ⇒ mở lại hàng inbox ở transaction riêng
      // và trả mã lỗi **retryable** để PSP gửi lại (AC3: không success-ACK khi chưa ghi nhận được).
      await this.inbox.fail(rowId, 'APPLY_FAILED', now);
      this.logger.error(
        { event: 'PSP_APPLY_FAILED', provider: method, correlationId: context.correlationId },
        'Webhook apply failed',
      );
      return ackFor(method, 'UNSTORED');
    }
  }

  /** Logs keep mã/ca — chỉ dữ liệu đã chuẩn hoá, không tham số thô của cổng (BR-PAY-04, api.md §5.3). */
  private trace(
    outcome: CallbackOutcome,
    method: PspMethod,
    verified: PspResult,
    context: WebhookContext,
  ): void {
    if (outcome === 'APPLIED' || outcome === 'DUPLICATE') return;
    this.logger.warn(
      {
        event: 'PSP_WEBHOOK_UNAPPLIED',
        provider: method,
        outcome,
        providerTxnId: verified.providerTxnId,
        correlationId: context.correlationId,
      },
      'PSP webhook stored but not applied',
    );
  }
}

function replayOf(reason: string | null): CallbackOutcome {
  if (reason === 'ORDER_UNKNOWN' || reason === 'AMOUNT_MISMATCH') return reason;
  if (reason === 'PAYLOAD_HASH_MISMATCH') return 'RECONCILE';
  return 'DUPLICATE';
}

export interface InboxAuditInput {
  readonly rowId: string;
  /** `true` = cùng `event_id` nhưng payload khác hàng gốc (P1/F6) — mã ACK lặp lại vẫn theo kết cục. */
  readonly mismatch: boolean;
  /** `true` = lần gửi này **đã được áp dụng** (hàng PENDING/FAILED), `false` = hàng đã xong. */
  readonly reapplied: boolean;
  readonly method: PspMethod;
  readonly eventId: string;
  readonly verified: PspResult;
  readonly storedPayloadHash: string;
  readonly incomingPayloadHash: string;
  readonly decision: CallbackOutcome;
}

/**
 * Vết audit của **một sự kiện inbox đã xác minh** (kể cả bản phát lại / payload khác). Không đụng
 * `last_error` của hàng gốc: `last_error` là trạng thái phát lại của hàng, còn sai khác payload là dữ
 * kiện đối soát độc lập (P1/F6, csdl §3).
 */
async function recordInboxAudit(
  tx: Prisma.TransactionClient,
  audit: AuditWriter,
  actor: ActorContext,
  input: InboxAuditInput,
): Promise<void> {
  await audit.record(tx, {
    actor,
    action: input.mismatch ? 'PAYMENT_WEBHOOK_PAYLOAD_MISMATCH' : 'PAYMENT_WEBHOOK_REPLAYED',
    entityType: 'WebhookInbox',
    entityId: input.rowId,
    beforeJson: null,
    afterJson: {
      provider: input.method,
      eventId: input.eventId,
      orderRef: input.verified.orderRef,
      providerTxnId: input.verified.providerTxnId,
      outcome: input.verified.outcome,
      decision: input.decision,
      storedPayloadHash: input.storedPayloadHash,
      incomingPayloadHash: input.incomingPayloadHash,
      reapplied: input.reapplied,
    },
    reason: input.mismatch
      ? 'Same event id with a different payload'
      : 'Duplicate delivery of a stored event',
  });
}
