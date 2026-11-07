import type { PrismaClient, channels } from '@prisma/client';
import {
  channelQuerySchema,
  channelSummarySchema,
  type ChannelSummary,
  type ListPage,
} from '@pinehill/contracts';
import { channelConfigWarnings } from '@pinehill/domain/pricing';
import type { ChannelRateConfig } from '@pinehill/domain/pricing';
import { z } from 'zod';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
const querySchema = channelQuerySchema.extend({ cursor: z.uuid().optional() });
function input(value: unknown) {
  const parsed = querySchema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
  return parsed.data;
}
/** Hệ số/hoa hồng mặc định dạng chuỗi thập phân thuần (không số mũ) để engine so sánh chính xác. */
function rateConfig(row: channels): ChannelRateConfig {
  return {
    code: row.code,
    multiplier: row.multiplier.toFixed(),
    commissionPercent: row.commission_pct.toFixed(),
  };
}
function summary(row: channels, web: ChannelRateConfig | null): ChannelSummary {
  const version = Number(row.version);
  if (!Number.isSafeInteger(version)) throw new Error('CHANNEL_VERSION_OUT_OF_RANGE');
  // Global defaults only; no sync metadata, credentials or property-specific overrides.
  return channelSummarySchema.parse({
    id: row.id,
    code: row.code,
    name: row.name,
    multiplier: row.multiplier.toNumber(),
    commissionPct: row.commission_pct.toNumber(),
    holdMinutes: row.hold_minutes,
    overbookAllowed: row.overbook_allowed,
    version,
    rateWarnings: channelConfigWarnings(rateConfig(row), web),
  });
}
export class ChannelsService {
  constructor(readonly db: PrismaClient) {}
  async list(actor: AuthorizedActor, value: unknown): Promise<ListPage<ChannelSummary>> {
    if (!['MANAGER', 'OWNER'].includes(actor.role))
      throw new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thực hiện thao tác này.');
    const query = input(value);
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.channels.count();
        const rows = await tx.channels.findMany({
          where: query.cursor ? { id: { gt: query.cursor } } : {},
          orderBy: { id: 'asc' },
          take: query.limit + 1,
        });
        // `WEB` có thể nằm ngoài trang hiện tại nên đọc riêng trong cùng snapshot (RepeatableRead).
        const webRow = await tx.channels.findFirst({ where: { code: 'WEB' } });
        const web = webRow === null ? null : rateConfig(webRow);
        const selected = rows.slice(0, query.limit),
          hasMore = rows.length > query.limit;
        return {
          data: selected.map((row) => summary(row, web)),
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
  }
}
