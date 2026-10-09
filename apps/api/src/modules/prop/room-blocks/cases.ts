import type { Prisma } from '@prisma/client';
import { calculateAvailability } from '@pinehill/domain/inventory';
import type { AvailabilityInput } from '@pinehill/domain/inventory';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { caseWindows, effectiveDemand } from './case-windows.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
/** Aggregate shortage plus active allocations requiring relocation (BR-INV-06). */
export async function recordCases(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  facts: AvailabilityInput,
  audit: AuditWriter,
) {
  for (const window of caseWindows(facts)) {
    // Yield to PostgreSQL between bounded CPU batches; transaction timeout remains enforceable.
    await tx.$queryRaw`SELECT 1`;
    await recordWindow(tx, actor, { ...facts, ...window }, audit);
  }
}
async function recordWindow(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  facts: AvailabilityInput,
  audit: AuditWriter,
) {
  const result = calculateAvailability(facts);
  if (!result.ok && result.error.code === 'E_INV_INVALID_INPUT')
    throw new Error('Invalid inventory database facts');
  const availability = result.ok
    ? result.value
    : result.error.code === 'E_INV_NO_AVAILABILITY'
      ? result.error.availability
      : null;
  if (!availability) throw new Error('Invalid inventory database facts');
  for (const night of availability.nightly) {
    const displaced = new Set(
      facts.assignments
        .filter(
          (a) =>
            a.releasedAt === null &&
            a.checkIn <= night.date &&
            a.checkOut > night.date &&
            facts.blocks.some(
              (b) => b.roomId === a.roomId && b.checkIn <= night.date && b.checkOut > night.date,
            ) &&
            facts.demand.some(
              (d) =>
                d.bookingRoomId === a.bookingRoomId &&
                d.checkIn <= night.date &&
                d.checkOut > night.date &&
                effectiveDemand(d, facts.now),
            ),
        )
        .map((a) => a.bookingRoomId),
    );
    const shortage = Math.max(0, -night.pool, displaced.size);
    if (shortage === 0) continue;
    const existing = await tx.overbooking_cases.findFirst({
      where: {
        property_id: facts.propertyId,
        room_type_id: facts.roomTypeId,
        date: new Date(`${night.date}T00:00:00Z`),
        status: { not: 'RESOLVED' },
      },
    });
    const entry = existing
      ? await tx.overbooking_cases.update({
          where: { id: existing.id },
          data: { shortage_count: shortage },
        })
      : await tx.overbooking_cases.create({
          data: {
            property_id: facts.propertyId,
            room_type_id: facts.roomTypeId,
            date: new Date(`${night.date}T00:00:00Z`),
            shortage_count: shortage,
          },
        });
    await audit.record(tx, {
      actor,
      action: 'ROOM_BLOCK_SHORTAGE_DETECTED',
      entityType: 'OverbookingCase',
      entityId: entry.id,
      beforeJson: existing
        ? { shortageCount: existing.shortage_count, status: existing.status }
        : null,
      afterJson: {
        propertyId: facts.propertyId,
        roomTypeId: facts.roomTypeId,
        date: night.date,
        shortageCount: shortage,
        status: entry.status,
      },
      reason: 'ROOM_BLOCK',
    });
  }
}
