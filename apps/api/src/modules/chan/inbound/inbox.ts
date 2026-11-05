/** Đọc hàng `webhook_inbox` theo **mã sự kiện của kênh** (`event_id`), đúng khoá mà webhook HB-128 ghi. */
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface InboxRecord {
  readonly id: string;
  readonly eventId: string;
  readonly status: string;
  readonly provider: string;
  readonly accountId: string;
  readonly payloadHash: string;
  readonly payload: Prisma.JsonValue;
}

export async function loadInboxRow(tx: Tx, eventId: string): Promise<InboxRecord | null> {
  const row = await tx.webhook_inbox.findFirst({
    where: { event_id: eventId },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      event_id: true,
      status: true,
      provider: true,
      provider_account_id: true,
      payload_hash: true,
      payload_json: true,
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    status: row.status,
    provider: row.provider,
    accountId: row.provider_account_id,
    payloadHash: row.payload_hash,
    payload: row.payload_json,
  };
}
