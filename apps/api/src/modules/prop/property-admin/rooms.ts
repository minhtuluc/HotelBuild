import { inventoryChanged } from './events.js';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { lockProperty, currentActor, record, safeError, checkRoomCode } from './mutation.js';
import { roomCreate, roomUpdate } from './validation.js';
import { roomView, beds } from './projection.js';
import { roomToken } from './reads.js';
import { missing, invalid, conflict } from './support.js';
function roomChanges(input: ReturnType<typeof roomUpdate>, now: Date) {
  const changes: Prisma.Sql[] = [
    Prisma.sql`updated_at=GREATEST(updated_at+interval '1 microsecond',${now}::timestamptz)`,
  ];
  if (input.floor !== undefined) changes.push(Prisma.sql`floor=${input.floor}`);
  if (input.status !== undefined) changes.push(Prisma.sql`status=${input.status}`);
  if (input.note !== undefined) changes.push(Prisma.sql`note=${input.note}`);
  return changes;
}
export class RoomCommands {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly ids: IdGenerator,
    readonly registry: PermissionRegistry,
  ) {}
  async create(tx: Prisma.TransactionClient, actor: AuthorizedActor, body: unknown) {
    try {
      const input = roomCreate(body);
      await lockProperty(tx, input.propertyId);
      await tx.$queryRaw`SELECT id FROM room_types WHERE id=${input.roomTypeId}::uuid FOR UPDATE`;
      const type = await tx.room_types.findUnique({ where: { id: input.roomTypeId } }),
        prop = await tx.properties.findUnique({ where: { id: input.propertyId } });
      if (!type || !prop) throw missing();
      requireProperty(actor, type.property_id);
      if (
        type.property_id !== input.propertyId ||
        type.status !== 'ACTIVE' ||
        prop.status !== 'ACTIVE'
      )
        throw invalid();
      checkRoomCode(input.code, prop.code);
      const fresh = await currentActor(
        tx,
        actor,
        input.propertyId,
        'propertyAdmin.rooms',
        this.registry,
      );
      const after = await tx.rooms.create({
        data: {
          id: this.ids.generate(),
          property_id: input.propertyId,
          room_type_id: type.id,
          code: input.code,
          name: input.code,
          floor: input.floor,
          status: input.status ?? 'ACTIVE',
          ...(input.note === undefined ? {} : { note: input.note }),
          bed_count: beds(type),
          updated_at: this.clock.now(),
        },
      });
      const view = roomView(after, await roomToken(tx, after.id));
      await record(
        tx,
        fresh,
        this.clock,
        'Room',
        after.id,
        input.propertyId,
        null,
        { ...view, note: after.note },
        input.reason,
      );
      await inventoryChanged(tx, this.ids, {
        entityType: 'Room',
        entityId: view.id,
        propertyId: view.propertyId,
        roomTypeId: view.roomTypeId,
        version: view.version,
      });
      return view;
    } catch (error) {
      safeError(error);
    }
  }
  async update(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    version: bigint,
    body: unknown,
  ) {
    try {
      const input = roomUpdate(body),
        initial = await tx.rooms.findUnique({ where: { id } });
      if (!initial) throw missing();
      await lockProperty(tx, initial.property_id);
      await tx.$queryRaw`SELECT id FROM room_types WHERE id=${initial.room_type_id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM rooms WHERE id=${id}::uuid FOR UPDATE`;
      const before = await tx.rooms.findUnique({ where: { id } });
      if (!before) throw missing();
      if (
        before.property_id !== initial.property_id ||
        before.room_type_id !== initial.room_type_id
      )
        throw conflict();
      const fresh = await currentActor(
          tx,
          actor,
          before.property_id,
          'propertyAdmin.rooms',
          this.registry,
        ),
        token = await roomToken(tx, id);
      if (token !== version) throw conflict();
      const changes = roomChanges(input, this.clock.now());
      await tx.$executeRaw(
        Prisma.sql`UPDATE rooms SET ${Prisma.join(changes)} WHERE id=${id}::uuid`,
      );
      const after = await tx.rooms.findUnique({ where: { id } });
      if (!after) throw missing();
      const view = roomView(after, await roomToken(tx, id));
      await record(
        tx,
        fresh,
        this.clock,
        'Room',
        id,
        after.property_id,
        { ...roomView(before, token), note: before.note },
        { ...view, note: after.note },
        input.reason,
      );
      await inventoryChanged(tx, this.ids, {
        entityType: 'Room',
        entityId: view.id,
        propertyId: view.propertyId,
        roomTypeId: view.roomTypeId,
        version: view.version,
      });
      return view;
    } catch (error) {
      safeError(error);
    }
  }
}
