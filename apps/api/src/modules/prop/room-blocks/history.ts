import type { Prisma, room_blocks } from '@prisma/client';
import { roomBlockReasonSchema } from '@pinehill/contracts';
import type { RoomBlock } from '@pinehill/contracts';
import { dateOnly } from '../../inv/facts/loader.js';
export async function blockHistory(
  tx: Pick<Prisma.TransactionClient, 'audit_logs'>,
  id: string,
): Promise<{ note: string | null; propertyId?: string }> {
  const log = await tx.audit_logs.findFirst({
    where: { entity_id: id, entity_type: 'RoomBlock', action: 'ROOM_BLOCK_CREATED' },
    orderBy: { chain_seq: 'desc' },
    select: { after_json: true },
  });
  const value = log?.after_json;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { note: null };
  return {
    note: typeof value.note === 'string' ? value.note : null,
    ...(typeof value.propertyId === 'string' ? { propertyId: value.propertyId } : {}),
  };
}
export function blockDto(block: room_blocks, note: string | null): RoomBlock {
  return {
    id: block.id,
    roomId: block.room_id,
    startDate: dateOnly(block.start_date),
    endDate: dateOnly(block.end_date),
    reason: roomBlockReasonSchema.parse(block.reason),
    note,
  };
}
export function blockSnapshot(block: room_blocks, note: string | null) {
  return {
    ...block,
    start_date: dateOnly(block.start_date),
    end_date: dateOnly(block.end_date),
    created_at: block.created_at.toISOString(),
    updated_at: block.updated_at.toISOString(),
    note,
  };
}
