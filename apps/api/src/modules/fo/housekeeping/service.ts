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
import { conflict, forbidden, invalid, missing, roomNotActive, taskExists } from './validation.js';
import type { Create, Query, Update } from './validation.js';
import { fieldPermissions, transition } from './transitions.js';
const readers = ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER'];
/** Vai trò được ghi nhận nhiệm vụ/biên bản kiểm cho phòng (HB-207; api.md §2.9). */
const creators = ['FRONT_DESK', 'MANAGER'];
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
            property_id: { in: [...actor.propertyScope] },
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
    if (!user.user_property_scopes.some((scope) => scope.property_id === propertyId))
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

  /** Kiểm trước idempotency: vai trò, phòng tồn tại và nằm trong phạm vi (không đọc trạng thái phòng). */
  async authorizeCreate(
    tx: Prisma.TransactionClient | PrismaClient,
    actor: AuthorizedActor,
    input: Create,
  ): Promise<void> {
    if (!creators.includes(actor.role)) throw forbidden();
    const room = await tx.rooms.findUnique({
      where: { id: input.roomId },
      select: { property_id: true },
    });
    if (!room) throw missing();
    requireProperty(actor, room.property_id);
  }
  /**
   * Ghi nhận nhiệm vụ cho `(phòng, ngày)` (BR-FO-07, F7-QA-01). Khoá phòng trước như check-in và PATCH
   * (ADR-014); ràng buộc duy nhất `(room_id, business_date)` + `skipDuplicates` làm hai lệnh đồng thời
   * chỉ có một lệnh ghi được mà không làm hỏng giao dịch. Đã có nhiệm vụ (mọi trạng thái) ⇒ 409:
   * chuyển trạng thái đi qua PATCH, không tạo dòng thứ hai.
   */
  async create(tx: Prisma.TransactionClient, actor: AuthorizedActor, input: Create) {
    try {
      await this.authorizeCreate(tx, actor, input);
      await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
      const [locked] = await tx.$queryRaw<
        { property_id: string; status: string }[]
      >`SELECT property_id, status FROM rooms WHERE id=${input.roomId}::uuid FOR UPDATE`;
      if (!locked) throw missing();
      requireProperty(actor, locked.property_id);
      await this.currentActor(tx, actor, locked.property_id);
      if (locked.status !== 'ACTIVE') throw roomNotActive();
      const now = this.clock.now();
      const inserted = await tx.housekeeping_tasks.createMany({
        data: [
          {
            room_id: input.roomId,
            business_date: new Date(`${input.businessDate}T00:00:00Z`),
            status: input.status,
            note: input.note ?? null,
            completed_at: input.status === 'INSPECTED' ? now : null,
            created_at: now,
            updated_at: now,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count !== 1) throw taskExists();
      const created = await tx.housekeeping_tasks.findFirst({
        where: {
          room_id: input.roomId,
          business_date: new Date(`${input.businessDate}T00:00:00Z`),
        },
        select: taskSelect,
      });
      if (!created) throw new Error('HOUSEKEEPING_CREATE_READBACK_MISSING');
      const body = project(created);
      await this.audit.record(tx, {
        actor,
        action: 'HOUSEKEEPING_TASK_CREATED',
        entityType: 'HousekeepingTask',
        entityId: created.id,
        beforeJson: null,
        afterJson: body,
        reason: input.reason,
      });
      return body;
    } catch (error) {
      safeError(error);
    }
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
