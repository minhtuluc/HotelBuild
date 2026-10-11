import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty, ScopeDeniedError } from '../../../common/rbac/scope.js';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { taskSelect, project } from './projection.js';
import type { Task } from './projection.js';
import { conflict, forbidden, invalid, missing } from './validation.js';
import type { Query, Update } from './validation.js';
import { fieldPermissions, transition } from './transitions.js';
const readers = ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER', 'OWNER'];
function changes(input: Update, clock: Clock): Prisma.housekeeping_tasksUncheckedUpdateInput {
  return {
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.assignedTo === undefined ? {} : { assigned_to: input.assignedTo }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.status === 'DONE'
      ? { completed_at: clock.now() }
      : input.status === 'PENDING'
        ? { completed_at: null }
        : {}),
    updated_at: clock.now(),
  };
}
function safeError(error: unknown): never {
  if (error instanceof AppError || error instanceof RetryTransaction) throw error;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(String(error.meta?.code))))
  )
    throw new RetryTransaction(
      new AppError(
        409,
        'E_SYS_REQUEST_IN_PROGRESS',
        'Nhiệm vụ đang được cập nhật; vui lòng thử lại.',
        1,
      ),
    );
  throw new Error('HOUSEKEEPING_DATABASE_FAILURE');
}
export class HousekeepingService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
  ) {}
  async list(actor: AuthorizedActor, query: Query) {
    if (!readers.includes(actor.role)) throw forbidden();
    if (query.propertyId) requireProperty(actor, query.propertyId);
    const where: Prisma.housekeeping_tasksWhereInput = {
      AND: [
        { business_date: new Date(`${query.businessDate}T00:00:00Z`) },
        {
          rooms: {
            ...(actor.isOwner() ? {} : { property_id: { in: [...actor.propertyScope] } }),
            ...(query.propertyId ? { property_id: query.propertyId } : {}),
          },
        },
        ...(actor.role === 'HOUSEKEEPING' ? [{ assigned_to: actor.id }] : []),
        ...(query.assignedTo ? [{ assigned_to: query.assignedTo }] : []),
        ...(query.status ? [{ status: query.status }] : []),
      ],
    };
    try {
      return await this.db.$transaction(
        async (tx) => {
          if (
            query.cursor &&
            !(await tx.housekeeping_tasks.findFirst({
              where: { AND: [where, { id: query.cursor }] },
              select: { id: true },
            }))
          )
            throw invalid();
          const total = await tx.housekeeping_tasks.count({ where });
          const tasks = await tx.housekeeping_tasks.findMany({
            where: { AND: [where, ...(query.cursor ? [{ id: { gt: query.cursor } }] : [])] },
            orderBy: { id: 'asc' },
            take: query.limit + 1,
            select: taskSelect,
          });
          const selected = tasks.slice(0, query.limit),
            hasMore = tasks.length > query.limit;
          return {
            data: selected.map(project),
            meta: {
              total,
              limit: query.limit,
              hasMore,
              nextCursor: hasMore ? selected.at(-1)!.id : null,
            },
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    } catch (error) {
      safeError(error);
    }
  }
  async authorize(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    input: Update,
  ): Promise<Task> {
    if (!readers.includes(actor.role)) throw forbidden();
    fieldPermissions(actor, input);
    const task = await tx.housekeeping_tasks.findUnique({ where: { id }, select: taskSelect });
    if (!task) throw missing();
    requireProperty(actor, task.rooms.property_id);
    if (actor.role === 'HOUSEKEEPING' && task.assigned_to !== actor.id) throw forbidden();
    return task;
  }
  private async currentActor(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    propertyId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.id}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT user_id FROM user_property_scopes WHERE user_id=${actor.id}::uuid AND property_id=${propertyId}::uuid FOR SHARE`;
    const user = await tx.users.findUnique({
      where: { id: actor.id },
      select: {
        role: true,
        is_active: true,
        user_property_scopes: { select: { property_id: true } },
      },
    });
    if (!user?.is_active || user.role !== actor.role) throw forbidden();
    if (
      user.role !== 'OWNER' &&
      !user.user_property_scopes.some((scope) => scope.property_id === propertyId)
    )
      throw new ScopeDeniedError();
  }
  private async assignee(tx: Prisma.TransactionClient, input: Update, propertyId: string) {
    if (input.assignedTo === undefined || input.assignedTo === null) return;
    await tx.$queryRaw`SELECT id FROM users WHERE id=${input.assignedTo}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT user_id FROM user_property_scopes WHERE user_id=${input.assignedTo}::uuid AND property_id=${propertyId}::uuid FOR SHARE`;
    const user = await tx.users.findUnique({
      where: { id: input.assignedTo },
      select: {
        role: true,
        is_active: true,
        user_property_scopes: { select: { property_id: true } },
      },
    });
    if (
      !user?.is_active ||
      user.role !== 'HOUSEKEEPING' ||
      !user.user_property_scopes.some((scope) => scope.property_id === propertyId)
    )
      throw invalid();
  }
  async update(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    input: Update,
    expected: bigint,
  ) {
    try {
      const initial = await this.authorize(tx, actor, id, input);
      await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
      // Shared handover resource: future check-in must lock this same physical Room before readiness.
      await tx.$queryRaw`SELECT id FROM rooms WHERE id=${initial.room_id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM housekeeping_tasks WHERE id=${id}::uuid FOR UPDATE`;
      const before = await this.authorize(tx, actor, id, input);
      if (before.room_id !== initial.room_id) throw new RetryTransaction(conflict());
      await this.currentActor(tx, actor, before.rooms.property_id);
      if (before.version !== expected || before.version >= BigInt(Number.MAX_SAFE_INTEGER))
        throw conflict();
      transition(before.status, input.status);
      await this.assignee(tx, input, before.rooms.property_id);
      const after = await tx.housekeeping_tasks.update({
        where: { id },
        data: changes(input, this.clock),
        select: taskSelect,
      });
      const body = project(after);
      await this.audit.record(tx, {
        actor,
        action: 'HOUSEKEEPING_TASK_UPDATED',
        entityType: 'HousekeepingTask',
        entityId: id,
        beforeJson: project(before),
        afterJson: body,
        reason: input.reason ?? null,
      });
      return body;
    } catch (error) {
      safeError(error);
    }
  }
}
