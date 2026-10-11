import type { PrismaClient } from '@prisma/client';
import { systemSettingQuerySchema, systemSettingSchema } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { forbidden, invalid, safeError } from './validation.js';
import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { authorize, updateSetting } from './command.js';
import type { SettingInput } from './command.js';
export class SettingsService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
  ) {}
  authorize(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    key: string,
    input: SettingInput,
  ) {
    return authorize(tx, actor, key, input);
  }
  update(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    key: string,
    input: SettingInput,
    version: bigint,
  ) {
    return updateSetting(tx, actor, key, input, version, this.clock);
  }
  async list(actor: AuthorizedActor, query: unknown) {
    if (actor.role !== 'OWNER') throw forbidden();
    const parsed = systemSettingQuerySchema.safeParse(query);
    if (!parsed.success) throw invalid();
    const { limit, cursor } = parsed.data;
    try {
      return await this.db.$transaction(
        async (tx) => {
          if (
            cursor &&
            !(await tx.system_settings.findUnique({ where: { key: cursor }, select: { id: true } }))
          )
            throw invalid();
          const total = await tx.system_settings.count();
          const rows = await tx.system_settings.findMany({
            where: cursor ? { key: { gt: cursor } } : {},
            orderBy: { key: 'asc' },
            take: limit + 1,
          });
          const selected = rows.slice(0, limit),
            hasMore = rows.length > limit;
          return {
            data: selected.map((row) =>
              systemSettingSchema.parse({
                key: row.key,
                value: row.value,
                valueType: row.value_type,
                description: row.description?.trim() || row.key,
                updatedBy: row.updated_by ?? 'SYSTEM',
                updatedAt: row.updated_at.toISOString(),
                version: Number(row.version),
              }),
            ),
            meta: { total, limit, hasMore, nextCursor: hasMore ? selected.at(-1)!.key : null },
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    } catch (error) {
      safeError(error);
    }
  }
}
