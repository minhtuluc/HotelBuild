import type { Prisma, PrismaClient } from '@prisma/client';
import type { InventoryGrid, InventoryRoomTypeGrid } from '@pinehill/contracts';
import { calculateAvailability } from '@pinehill/domain/inventory';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { loadInventoryFacts } from '../facts/loader.js';
import { forbidden, missing, nextDate } from '../allotments/validation.js';
import type { GridInput } from './validation.js';
export class GridService {
  constructor(readonly db: PrismaClient) {}
  async get(actor: AuthorizedActor, input: GridInput): Promise<InventoryGrid> {
    if (!['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'].includes(actor.role))
      throw forbidden();
    requireProperty(actor, input.propertyId);
    return this.db.$transaction(
      async (tx) => {
        const property = await tx.properties.findUnique({ where: { id: input.propertyId } });
        if (!property) throw missing();
        const types = await tx.room_types.findMany({
          where: {
            property_id: input.propertyId,
            ...(input.roomTypeId ? { id: input.roomTypeId } : {}),
          },
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (types.length === 0) throw missing();
        const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
        const channel = input.channelCode
          ? await tx.channels.findUnique({
              where: { code: input.channelCode },
              select: { status: true },
            })
          : null;
        const grids: InventoryRoomTypeGrid[] = [];
        for (const type of types)
          grids.push(await this.roomType(tx, input, type.id, now, channel?.status === 'ACTIVE'));
        const projection = input.roomTypeId ? grids[0]! : { ...grids[0]!, grids };
        return { ...projection, capturedAt: now.toISOString() };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async roomType(
    tx: Prisma.TransactionClient,
    input: GridInput,
    roomTypeId: string,
    now: Date,
    channelActive: boolean,
  ): Promise<InventoryRoomTypeGrid> {
    const facts = await loadInventoryFacts(tx, {
      propertyId: input.propertyId,
      roomTypeId,
      checkIn: input.from,
      checkOut: nextDate(input.to),
      channelCode: input.channelCode ?? 'WEB',
    });
    // Every type uses one database instant so a hold expiry cannot split a property response.
    const result = calculateAvailability({ ...facts, now });
    const availability = result.ok
      ? result.value
      : result.error.code === 'E_INV_NO_AVAILABILITY'
        ? result.error.availability
        : null;
    if (!availability) throw new Error('Invalid inventory facts');
    const active = facts.units.filter((unit) => unit.status === 'ACTIVE').length;
    return {
      propertyId: input.propertyId,
      roomTypeId,
      from: input.from,
      to: input.to,
      cells: availability.nightly.map((night) => ({
        date: night.date,
        supply: night.supply,
        demand: night.demand,
        pool: night.pool,
        blocked: active - night.supply,
        published: night.commercialAvailability,
        ...(input.channelCode
          ? { channelAvailable: channelActive ? night.channelAvailability : 0 }
          : {}),
      })),
    };
  }
}
