import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { forbidden } from '../../sys/settings/validation.js';
import * as mapping from './mapping.js';
import * as queries from './queries.js';
import { reportScope } from './scope.js';
import type {
  CancellationsInput,
  GroupedReportInput,
  OverbookingInput,
  RangeInput,
  RevenueByChannelInput,
} from './validation.js';

/**
 * UC-REP-01…04 (HB-162): đọc báo cáo từ dữ liệu thật, áp phạm vi cơ sở **tại tầng truy vấn**
 * (BR-RBAC-02) và kiểm vai trò lần hai trong service (hàng rào độc lập với `@Permission`).
 * Chỉ đọc: chạy trong `RepeatableRead` để một báo cáo không trộn hai trạng thái dữ liệu.
 */
export class ReportsService {
  constructor(
    readonly db: PrismaClient,
    readonly timezone: string,
  ) {}

  /** Phạm vi cơ sở + lọc cơ sở cụ thể, dựng theo bí danh cột của từng truy vấn. */
  private scope(actor: AuthorizedActor, propertyId?: string): queries.ScopedFilter {
    return (column) =>
      Prisma.sql`AND ${reportScope(actor, column)}${
        propertyId === undefined ? Prisma.empty : Prisma.sql` AND ${column} = ${propertyId}::uuid`
      }`;
  }

  private scoped(actor: AuthorizedActor, query: { propertyId?: string } = {}): Prisma.Sql {
    return Prisma.sql`AND ${reportScope(actor, Prisma.sql`b.property_id`)}${
      query.propertyId === undefined
        ? Prisma.empty
        : Prisma.sql` AND b.property_id = ${query.propertyId}::uuid`
    }`;
  }

  private readonly read = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    this.db.$transaction(work, { isolationLevel: 'RepeatableRead' });

  private permitted(actor: AuthorizedActor, roles: readonly string[]): void {
    if (!roles.includes(actor.role)) throw forbidden();
  }

  private inScope(actor: AuthorizedActor, propertyId?: string): void {
    if (propertyId !== undefined) requireProperty(actor, propertyId);
  }

  async occupancy(actor: AuthorizedActor, input: GroupedReportInput) {
    this.permitted(actor, ['MANAGER', 'OWNER']);
    this.inScope(actor, input.propertyId);
    const rows = await this.read((tx) =>
      tx.$queryRaw<queries.RoomNightAggregate[]>(
        queries.roomNightAggregates(input.from, input.to, this.scope(actor, input.propertyId)),
      ),
    );
    return mapping.occupancyReport(rows, input.groupBy, input.from, input.to);
  }

  async adrRevpar(actor: AuthorizedActor, input: GroupedReportInput) {
    this.permitted(actor, ['MANAGER', 'OWNER']);
    this.inScope(actor, input.propertyId);
    const rows = await this.read((tx) =>
      tx.$queryRaw<queries.RoomNightAggregate[]>(
        queries.roomNightAggregates(input.from, input.to, this.scope(actor, input.propertyId)),
      ),
    );
    return mapping.adrRevparReport(rows, input.groupBy, input.from, input.to);
  }

  async revenueByChannel(actor: AuthorizedActor, input: RevenueByChannelInput) {
    this.permitted(actor, ['ACCOUNTANT', 'OWNER']);
    this.inScope(actor, input.propertyId);
    const rows = await this.read((tx) =>
      tx.$queryRaw<queries.ChannelRevenueRow[]>(
        queries.channelRevenue(
          input.from,
          input.to,
          Prisma.sql`${this.scoped(actor, input)}${
            input.channelId === undefined
              ? Prisma.empty
              : Prisma.sql` AND b.channel_id = ${input.channelId}::uuid`
          }`,
        ),
      ),
    );
    return mapping.revenueByChannelReport(rows, input.from, input.to);
  }

  async cancellations(actor: AuthorizedActor, input: CancellationsInput) {
    this.permitted(actor, ['ACCOUNTANT', 'OWNER']);
    this.inScope(actor, input.propertyId);
    const [rate, tiers] = await this.read(async (tx) => {
      const filter = this.scoped(actor, input);
      const ratePlan =
        input.ratePlanCode === undefined
          ? Prisma.empty
          : Prisma.sql`AND rp.code = ${input.ratePlanCode}`;
      const rate = await tx.$queryRaw<queries.CancellationRateRow[]>(
        queries.cancellationRate(input.from, input.to, this.timezone, filter, ratePlan),
      );
      const tiers = await tx.$queryRaw<queries.CancellationTierRow[]>(
        queries.cancellationTiers(input.from, input.to, this.timezone, filter, ratePlan),
      );
      return [rate[0], tiers] as const;
    });
    return mapping.cancellationsReport(rate, tiers, input.from, input.to);
  }

  async forceMajeure(actor: AuthorizedActor, input: RangeInput) {
    this.permitted(actor, ['OWNER']);
    const rows = await this.read((tx) =>
      tx.$queryRaw<queries.ForceMajeureRow[]>(
        queries.forceMajeureRows(input.from, input.to, this.timezone, this.scoped(actor)),
      ),
    );
    return mapping.forceMajeureReport(rows, input.from, input.to);
  }

  async overbooking(actor: AuthorizedActor, input: OverbookingInput) {
    this.permitted(actor, ['MANAGER', 'OWNER']);
    this.inScope(actor, input.propertyId);
    const filter = Prisma.sql`AND ${reportScope(actor, Prisma.sql`c.property_id`)}${
      input.propertyId === undefined
        ? Prisma.empty
        : Prisma.sql` AND c.property_id = ${input.propertyId}::uuid`
    }`;
    const rows = await this.read((tx) =>
      tx.$queryRaw<queries.OverbookingRow[]>(
        queries.overbookingCases(
          input.from,
          input.to,
          filter,
          input.status === undefined ? Prisma.empty : Prisma.sql`AND c.status = ${input.status}`,
        ),
      ),
    );
    return mapping.overbookingReport(rows, input.from, input.to);
  }
}
