import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { auditLogQuerySchema } from '@pinehill/contracts';
import { z } from 'zod';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { forbidden, invalid, safeError } from '../settings/validation.js';
import { auditScope } from './scope.js';
import { project } from './projection.js';
import type { AuditRow } from './projection.js';
const querySchema = auditLogQuerySchema.extend({
  actorId: z.uuid().optional(),
  cursor: z.uuid().optional(),
});
function query(value: unknown) {
  const result = querySchema.safeParse(value);
  if (!result.success) throw invalid();
  for (const time of [result.data.from, result.data.to])
    if (
      time &&
      (!Number.isFinite(Date.parse(time)) ||
        new Date(time).toISOString().slice(0, 10) !== time.slice(0, 10))
    )
      throw invalid();
  if (
    result.data.from &&
    result.data.to &&
    Date.parse(result.data.from) >= Date.parse(result.data.to)
  )
    throw invalid();
  return result.data;
}
export class AuditLogsService {
  constructor(readonly db: PrismaClient) {}
  async list(actor: AuthorizedActor, input: unknown) {
    if (!['OWNER', 'MANAGER'].includes(actor.role)) throw forbidden();
    const q = query(input),
      filters = [auditScope(actor)];
    if (q.actorId) filters.push(Prisma.sql`a.actor_id=${q.actorId}::uuid`);
    if (q.entityType) filters.push(Prisma.sql`a.entity_type=${q.entityType}`);
    if (q.entityId) {
      // SCR-17 publishes logical keys. Resolve from immutable snapshots, never current settings.
      filters.push(
        q.entityType === 'SystemSetting'
          ? Prisma.sql`(a.entity_id::text=${q.entityId} OR a.before_json->>'key'=${q.entityId} OR a.after_json->>'key'=${q.entityId})`
          : Prisma.sql`a.entity_id::text=${q.entityId}`,
      );
    }
    if (q.action) filters.push(Prisma.sql`a.action=${q.action}`);
    if (q.from) filters.push(Prisma.sql`a.at>=${q.from}::timestamptz`);
    if (q.to) filters.push(Prisma.sql`a.at<${q.to}::timestamptz`);
    const where = Prisma.join(filters, ' AND ');
    try {
      return await this.db.$transaction(
        async (tx) => {
          if (
            q.cursor &&
            (
              await tx.$queryRaw<
                AuditRow[]
              >`SELECT a.* FROM audit_logs a WHERE ${where} AND a.id=${q.cursor}::uuid`
            ).length !== 1
          )
            throw invalid();
          const total = (
            await tx.$queryRaw<
              { n: bigint }[]
            >`SELECT count(*) AS n FROM audit_logs a WHERE ${where}`
          )[0]!.n;
          if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('SYS_UNSAFE_COUNT');
          const cursor = q.cursor
            ? Prisma.sql`AND (a.at,a.id)<(SELECT at,id FROM audit_logs WHERE id=${q.cursor}::uuid)`
            : Prisma.empty;
          const rows = await tx.$queryRaw<
            AuditRow[]
          >`SELECT a.id,a.actor_id,a.action,a.entity_type,a.entity_id,a.before_json,a.after_json,a.reason,a.at
        FROM audit_logs a WHERE ${where} ${cursor} ORDER BY a.at DESC,a.id DESC LIMIT ${q.limit + 1}`;
          const selected = rows.slice(0, q.limit),
            hasMore = rows.length > q.limit;
          return {
            data: selected.map(project),
            meta: {
              total: Number(total),
              limit: q.limit,
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
}
