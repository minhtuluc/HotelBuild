import { inventoryChanged } from './events.js';
import type { Prisma, PrismaClient, rooms } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { lockProperty, currentActor, record, safeError } from './mutation.js';
import { linkInput } from './validation.js';
import { roomView } from './projection.js';
import { roomToken } from './reads.js';
import { missing, invalid, conflict } from './support.js';
function changes(source: rooms, target: rooms | null, byId: Map<string, rooms>) {
  const next = new Map<string, string | null>();
  const detach = (room: rooms) => {
    next.set(room.id, null);
    if (room.connecting_room_id) {
      const partner = byId.get(room.connecting_room_id);
      if (!partner || partner.connecting_room_id !== room.id) throw invalid();
      next.set(partner.id, null);
    }
  };
  detach(source);
  if (target) {
    detach(target);
    next.set(source.id, target.id);
    next.set(target.id, source.id);
  }
  return next;
}
async function lockedGraph(tx: Prisma.TransactionClient, id: string, targetId: string | null) {
  const initial = await tx.rooms.findUnique({ where: { id } });
  if (!initial) throw missing();
  if (targetId === id) throw invalid();
  await lockProperty(tx, initial.property_id);
  // Small physical inventory: serialize the property's graph, then type/room locks in stable order.
  await tx.$queryRaw`SELECT id FROM room_types WHERE property_id=${initial.property_id}::uuid ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM rooms WHERE property_id=${initial.property_id}::uuid ORDER BY id FOR UPDATE`;
  const graph = await tx.rooms.findMany({ where: { property_id: initial.property_id } }),
    byId = new Map(graph.map((x) => [x.id, x]));
  const source = byId.get(id);
  if (!source) throw conflict();
  const target = targetId === null ? null : byId.get(targetId);
  if (targetId !== null && !target) throw invalid();
  return { source, target, byId };
}
export class ConnectingCommands {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly registry: PermissionRegistry,
    readonly ids: IdGenerator,
  ) {}
  async update(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    version: bigint,
    body: unknown,
  ) {
    try {
      const { source, target, byId } = await lockedGraph(tx, id, linkInput(body).connectingRoomId);
      const fresh = await currentActor(
          tx,
          actor,
          source.property_id,
          'propertyAdmin.rooms',
          this.registry,
        ),
        sourceToken = await roomToken(tx, id);
      if (sourceToken !== version) throw conflict();
      const next = changes(source, target ?? null, byId);
      for (const [roomId, partner] of [...next].sort(([a], [b]) => a.localeCompare(b))) {
        const before = byId.get(roomId)!;
        const beforeToken = await roomToken(tx, roomId);
        await tx.$executeRaw`UPDATE rooms SET connecting_room_id=${partner}::uuid,updated_at=GREATEST(updated_at+interval '1 microsecond',${this.clock.now()}::timestamptz) WHERE id=${roomId}::uuid`;
        const after = await tx.rooms.findUnique({ where: { id: roomId } });
        if (!after) throw missing();
        await record(
          tx,
          fresh,
          this.clock,
          'Room',
          roomId,
          source.property_id,
          roomView(before, beforeToken),
          roomView(after, await roomToken(tx, roomId)),
          'Connecting room configuration',
        );
      }
      const after = await tx.rooms.findUnique({ where: { id } });
      if (!after) throw missing();
      const view = roomView(after, await roomToken(tx, id));
      await inventoryChanged(tx, this.ids, {
        entityType: 'Room',
        entityId: id,
        propertyId: source.property_id,
        version: view.version,
        affectedRoomIds: [...next.keys()].sort(),
      });
      return view;
    } catch (error) {
      safeError(error);
    }
  }
}
