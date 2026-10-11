import type { Prisma } from '@prisma/client';
import type { IdGenerator } from '@pinehill/domain';
interface Change {
  entityType: 'Property' | 'RoomType' | 'Room';
  entityId: string;
  propertyId: string;
  version: number;
  roomTypeId?: string;
  affectedRoomIds?: string[];
}
/** Configuration changes apply to every date; never invent a booking/date horizon in the producer. */
export async function inventoryChanged(
  tx: Prisma.TransactionClient,
  ids: IdGenerator,
  change: Change,
) {
  await emit(tx, ids, 'InventoryChanged', change);
}
export async function typeChanged(tx: Prisma.TransactionClient, ids: IdGenerator, change: Change) {
  await emit(tx, ids, 'RateChanged', change);
  await emit(tx, ids, 'InventoryChanged', change);
}
async function emit(
  tx: Prisma.TransactionClient,
  ids: IdGenerator,
  eventType: string,
  change: Change,
) {
  await tx.outbox_events.create({
    data: {
      id: ids.generate(),
      event_type: eventType,
      aggregate_type: change.entityType,
      aggregate_id: change.entityId,
      payload_json: { schemaVersion: 1, ...change, scope: 'ALL_DATES' },
    },
  });
}
