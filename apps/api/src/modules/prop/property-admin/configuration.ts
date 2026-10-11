import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { lockProperty, currentActor, record, safeError } from './mutation.js';
import { propertyInput, typeCreate, typeUpdate, validateType } from './validation.js';
import { propertyView, typeView, beds } from './projection.js';
import { propertyInclude, typeInclude } from './reads.js';
import { missing, conflict } from './support.js';
function typeData(
  input: ReturnType<typeof typeUpdate>,
  before: Prisma.room_typesGetPayload<object>,
  now: Date,
) {
  return {
    capacity_adults: input.capacityAdults ?? before.capacity_adults,
    capacity_children: input.capacityChildren ?? before.capacity_children,
    base_price: BigInt(input.basePrice ?? before.base_price),
    min_price: BigInt(input.minPrice ?? before.min_price),
    max_price: BigInt(input.maxPrice ?? before.max_price),
    status: input.status ?? before.status,
    updated_at: now,
  };
}
export class ConfigurationCommands {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly ids: IdGenerator,
    readonly registry: PermissionRegistry,
  ) {}
  async property(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    version: bigint,
    body: unknown,
  ) {
    try {
      const input = propertyInput(body);
      await lockProperty(tx, id);
      const fresh = await currentActor(tx, actor, id, 'propertyAdmin.configure', this.registry);
      const before = await tx.properties.findUnique({ where: { id }, include: propertyInclude });
      if (!before) throw missing();
      if (before.version !== version) throw conflict();
      const after = await tx.properties.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.overbookLimitPct === undefined
            ? {}
            : { overbook_limit_pct: input.overbookLimitPct }),
          ...(input.checkInTime
            ? { check_in_time: new Date('1970-01-01T' + input.checkInTime + ':00Z') }
            : {}),
          ...(input.checkOutTime
            ? { check_out_time: new Date('1970-01-01T' + input.checkOutTime + ':00Z') }
            : {}),
          updated_at: this.clock.now(),
        },
        include: propertyInclude,
      });
      const view = propertyView(after);
      await record(
        tx,
        fresh,
        this.clock,
        'Property',
        id,
        id,
        propertyView(before),
        view,
        input.reason,
      );
      return view;
    } catch (error) {
      safeError(error);
    }
  }
  async createType(tx: Prisma.TransactionClient, actor: AuthorizedActor, body: unknown) {
    try {
      const input = typeCreate(body);
      await lockProperty(tx, input.propertyId);
      const fresh = await currentActor(
        tx,
        actor,
        input.propertyId,
        'propertyAdmin.configure',
        this.registry,
      );
      const data = {
        id: this.ids.generate(),
        property_id: input.propertyId,
        code: input.code,
        name: input.code,
        capacity_adults: input.capacityAdults,
        capacity_children: input.capacityChildren,
        base_price: BigInt(input.basePrice),
        min_price: BigInt(input.minPrice),
        max_price: BigInt(input.maxPrice),
        allow_shared: input.allowShared,
        updated_at: this.clock.now(),
      };
      validateType(data, input.bedCount);
      const after = await tx.room_types.create({ data, include: typeInclude });
      const view = typeView(after);
      await record(
        tx,
        fresh,
        this.clock,
        'RoomType',
        after.id,
        input.propertyId,
        null,
        view,
        'Create room type',
      );
      return view;
    } catch (error) {
      safeError(error);
    }
  }
  async updateType(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    version: bigint,
    body: unknown,
  ) {
    try {
      const input = typeUpdate(body),
        initial = await tx.room_types.findUnique({ where: { id } });
      if (!initial) throw missing();
      await lockProperty(tx, initial.property_id);
      await tx.$queryRaw`SELECT id FROM room_types WHERE id=${id}::uuid FOR UPDATE`;
      const before = await tx.room_types.findUnique({ where: { id }, include: typeInclude });
      if (!before) throw missing();
      if (before.property_id !== initial.property_id) throw conflict();
      const fresh = await currentActor(
        tx,
        actor,
        before.property_id,
        'propertyAdmin.configure',
        this.registry,
      );
      if (before.version !== version) throw conflict();
      const data = typeData(input, before, this.clock.now());
      validateType({ ...before, ...data });
      if (data.capacity_adults !== before.capacity_adults) {
        await tx.$queryRaw`SELECT id FROM rooms WHERE room_type_id=${id}::uuid ORDER BY id FOR UPDATE`;
        const count = beds({ ...before, ...data });
        await tx.$executeRaw`UPDATE rooms SET bed_count=${count},updated_at=GREATEST(updated_at+interval '1 microsecond',${this.clock.now()}::timestamptz) WHERE room_type_id=${id}::uuid`;
      }
      const after = await tx.room_types.update({ where: { id }, data, include: typeInclude });
      const view = typeView(after);
      await record(
        tx,
        fresh,
        this.clock,
        'RoomType',
        id,
        after.property_id,
        typeView(before),
        view,
        input.reason,
      );
      return view;
    } catch (error) {
      safeError(error);
    }
  }
}
