/**
 * Hộp thư vào bền — `webhook_inbox` (csdl §3), hợp đồng **dùng chung** cho mọi nguồn ngoài gọi vào
 * (PSP ở HB-095, OTA ở HB-128): một chỗ duy nhất biết cách ghi/chiếm/đóng hàng inbox; HB-128 sẽ
 * nhập đúng class này, không dựng kho lưu trữ thứ hai.
 *
 * Thứ tự bắt buộc (ADR-017 §3, api.md §5.3): xác minh chữ ký **trước**, rồi `receive` mở transaction
 * riêng và commit — chỉ sau khi hàm này trả về mới được ACK. Redis/BullMQ không phải bằng chứng "đã
 * nhận". `payload_json` chỉ chứa dữ liệu nghiệp vụ đã chuẩn hoá (mã giao dịch, số tiền, trạng thái);
 * không thẻ, không token, không PII (BR-PAY-04). Trùng khoá `(provider, provider_account_id, event_id)`
 * **cùng hash** là bản phát lại hợp lệ; **khác hash** thì không ghi đè payload gốc, chỉ ghi vết để
 * đối soát (csdl §3).
 */
import type { Prisma } from '@prisma/client';
import type { IdGenerator } from '@pinehill/domain';
import type { DatabaseClient } from '../../../infrastructure/prisma/prisma.module.js';

/** Trạng thái của csdl §3; `DEAD_LETTER` = lỗi nghiệp vụ vĩnh viễn, chỉ đối soát tay. */
export type InboxStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'DEAD_LETTER';

export interface InboxRow {
  readonly id: string;
  readonly status: string;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly payload_hash: string;
}

export interface InboxEntry {
  readonly provider: string;
  readonly providerAccountId: string;
  readonly eventId: string;
  readonly payloadHash: string;
  readonly payloadJson: Prisma.InputJsonValue;
  readonly receivedAt: Date;
}

export interface InboxReceipt {
  readonly row: InboxRow;
  /** `true` = hàng vừa ghi; `false` = bản phát lại, UNIQUE đã chặn hàng thứ hai. */
  readonly created: boolean;
  readonly hashMatches: boolean;
}

/** Kết cục khi không áp dụng được; `reason` là **mã** ngắn, không PII, dùng để đối soát. */
export interface InboxOutcome {
  readonly reason: string;
  readonly terminal: boolean;
}

const ROW = {
  id: true,
  status: true,
  attempts: true,
  last_error: true,
  payload_hash: true,
} satisfies Prisma.webhook_inboxSelect;

/** Lease một người xử lý; hết hạn thì người khác được chiếm lại (đủ lâu để một transaction xong). */
const LEASE_MS = 60_000;
const RETRY_MS = 30_000;

export class WebhookInbox {
  constructor(
    private readonly db: DatabaseClient,
    private readonly ids: IdGenerator,
  ) {}

  /** Ghi bền sự kiện **đã xác minh** và commit ngay: cổng ngoài chỉ được ACK sau khi hàm này trả về. */
  async receive(entry: InboxEntry): Promise<InboxReceipt> {
    return this.db.$transaction(async (tx) => {
      const inserted = await tx.webhook_inbox.createMany({
        data: [
          {
            provider: entry.provider,
            provider_account_id: entry.providerAccountId,
            event_id: entry.eventId,
            payload_hash: entry.payloadHash,
            payload_json: entry.payloadJson,
            signature_verified_at: entry.receivedAt,
            available_at: entry.receivedAt,
            created_at: entry.receivedAt,
            updated_at: entry.receivedAt,
          },
        ],
        skipDuplicates: true,
      });
      const row = await tx.webhook_inbox.findUniqueOrThrow({
        where: {
          provider_provider_account_id_event_id: {
            provider: entry.provider,
            provider_account_id: entry.providerAccountId,
            event_id: entry.eventId,
          },
        },
        select: ROW,
      });
      return {
        row,
        created: inserted.count === 1,
        hashMatches: row.payload_hash === entry.payloadHash,
      };
    });
  }

  /**
   * Chiếm hàng trong **transaction nghiệp vụ** bằng CAS một câu: chỉ PENDING/FAILED, hoặc PROCESSING
   * có lease đã hết hạn. `null` = hàng đã `PROCESSED`/`DEAD_LETTER` hoặc một người xử lý khác đang giữ.
   */
  async claim(tx: Prisma.TransactionClient, id: string, now: Date): Promise<InboxRow | null> {
    const claimed = await tx.webhook_inbox.updateMany({
      where: {
        id,
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { status: 'PROCESSING', lease_expires_at: { lt: now } },
        ],
      },
      data: {
        status: 'PROCESSING',
        lease_token: this.ids.generate(),
        lease_expires_at: new Date(now.getTime() + LEASE_MS),
        attempts: { increment: 1 },
        updated_at: now,
      },
    });
    return claimed.count === 1
      ? tx.webhook_inbox.findUniqueOrThrow({ where: { id }, select: ROW })
      : null;
  }

  /** Đóng `PROCESSED` trong **cùng** transaction với nghiệp vụ (ADR-017 §4). */
  async complete(tx: Prisma.TransactionClient, id: string, now: Date): Promise<void> {
    await tx.webhook_inbox.update({
      where: { id },
      data: {
        status: 'PROCESSED',
        processed_at: now,
        lease_token: null,
        lease_expires_at: null,
        last_error: null,
        updated_at: now,
      },
    });
  }

  /**
   * Kết cục không áp dụng được: `terminal` ⇒ `DEAD_LETTER` cần đối soát tay, ngược lại `FAILED`
   * với `available_at` lùi lại để phát lại (người phát lại có thể là callback lặp lại của cổng).
   */
  async settle(
    tx: Prisma.TransactionClient,
    id: string,
    now: Date,
    outcome: InboxOutcome,
  ): Promise<void> {
    await tx.webhook_inbox.update({
      where: { id },
      data: {
        status: outcome.terminal ? 'DEAD_LETTER' : 'FAILED',
        last_error: outcome.reason,
        lease_token: null,
        lease_expires_at: null,
        ...(outcome.terminal ? {} : { available_at: new Date(now.getTime() + RETRY_MS) }),
        updated_at: now,
      },
    });
  }

  /** Sau khi transaction nghiệp vụ rollback: mở lại hàng về `FAILED` ở **transaction riêng**. */
  async fail(id: string, reason: string, now: Date): Promise<void> {
    await this.db.webhook_inbox.update({
      where: { id },
      data: {
        status: 'FAILED',
        last_error: reason,
        lease_token: null,
        lease_expires_at: null,
        available_at: new Date(now.getTime() + RETRY_MS),
        updated_at: now,
      },
    });
  }
}
