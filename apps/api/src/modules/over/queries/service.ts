/**
 * Đường đọc ca quá tải (HB-126; api.md §3.9 + HB-120 AC12).
 *
 * - `GET /overbooking-cases` / `{id}` chỉ MANAGER/OWNER theo `propertyScope`; lọc `propertyId` của
 *   người ngoài scope trả `403 E_AUTH_OUT_OF_SCOPE`, không lộ ca của cơ sở khác.
 * - `affectedBookingIds` và `ladderPreview` được **tính lại** từ nhu cầu hiện tại của đúng đêm
 *   (chưa có bảng ứng viên bền trong HB-121) theo BR-OVER-11/12 — shortageCount ứng viên đầu tiên.
 * - `GET /overbooking-alerts` là projection tối giản cho FRONT_DESK: không rank/keepScore/PII, chỉ
 *   booking cần xử lý, nhãn và deep link được phép.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { candidatesForCase } from '../detection/candidates.js';
import type { BalancedCandidate, LadderRung } from '../detection/candidates.js';
import { deadlineOf } from '../detection/engine.js';
import { loadPropertyFacts } from '../detection/facts.js';
import type { PropertyFacts } from '../detection/facts.js';
import type { CaseRow } from '../detection/support.js';
import { caseStatus, resolutionSource } from '../detection/support.js';
import { detailCandidates, historyOf, type CaseHistoryEvent } from './detail-view.js';
import { scanMeta } from './scan-meta.js';
import type { AlertQuery, CaseCursor, CaseQuery } from './validation.js';
import { decodeCursor, encodeCursor } from './validation.js';

export type CaseStatusView = 'OPEN' | 'PROPOSED' | 'RESOLVED' | 'ESCALATED';

export interface CaseSummaryView {
  readonly id: string;
  readonly propertyId: string;
  readonly date: string;
  readonly roomTypeId: string;
  readonly shortageCount: number;
  readonly status: CaseStatusView;
  readonly detectedAt: string;
  readonly resolveDeadline: string;
  readonly escalatedAt: string | null;
  readonly overdue: boolean;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly resolutionSource: 'USER' | 'SYSTEM' | null;
  readonly delayReason: string | null;
  readonly affectedBookingIds: readonly string[];
  readonly ladderPreview: readonly LadderRung[];
  readonly version: number;
}

export interface AlertItemView {
  readonly caseId: string;
  readonly bookingId: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly date: string;
  readonly status: CaseStatusView;
  readonly overdue: boolean;
  readonly label: string;
  readonly deepLink: string;
}

interface CaseDetail extends CaseSummaryView {
  readonly candidates: readonly BalancedCandidate[];
  readonly history: readonly CaseHistoryEvent[];
}

const caseSelect = {
  id: true,
  property_id: true,
  date: true,
  room_type_id: true,
  shortage_count: true,
  status: true,
  detected_at: true,
  resolved_at: true,
  escalated_at: true,
  delay_reason: true,
  resolved_by: true,
  resolution_source: true,
  version: true,
} satisfies Prisma.overbooking_casesSelect;

type SelectedCase = Prisma.overbooking_casesGetPayload<{ select: typeof caseSelect }>;

/** Ca đọc cho projection: thêm `version` để client gửi `If-Match` (hợp đồng `overbookingCaseSummarySchema`). */
type QueryCaseRow = CaseRow & { readonly version: bigint };

function toCaseRow(row: SelectedCase): QueryCaseRow {
  return {
    ...row,
    date: row.date.toISOString().slice(0, 10),
    status: caseStatus(row.status),
    resolution_source: resolutionSource(row.resolution_source),
  };
}

function notFound(): AppError {
  return new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy ca quá tải.');
}

function fallbackLadder(): readonly LadderRung[] {
  return [
    { moveType: 'SAME_TYPE_SAME_PROPERTY', feasible: false, candidateCount: 0 },
    { moveType: 'UPGRADE_SAME_PROPERTY', feasible: false, candidateCount: 0 },
    {
      moveType: 'SAME_TYPE_CROSS_PROPERTY',
      feasible: false,
      candidateCount: 0,
      note: 'bậc 3 không khả dụng: ba cơ sở cách nhau 160–300 km (> 15 km)',
    },
    { moveType: 'WALK_OUT', feasible: true, candidateCount: 0 },
  ];
}

interface SummaryResult {
  readonly view: CaseSummaryView;
  readonly candidates: readonly BalancedCandidate[];
}

export class OverbookingQueries {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
  ) {}

  private async factsFor(
    row: CaseRow,
    now: Date,
    cache: Map<string, PropertyFacts>,
  ): Promise<PropertyFacts> {
    const key = `${row.property_id}|${row.date}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const facts = await loadPropertyFacts(this.db, row.property_id, now, {
      dates: [row.date],
    });
    cache.set(key, facts);
    return facts;
  }

  private async summarize(
    row: QueryCaseRow,
    now: Date,
    cache: Map<string, PropertyFacts>,
  ): Promise<SummaryResult> {
    const facts = await this.factsFor(row, now, cache);
    const deadline = deadlineOf(facts, row.date);
    const type = facts.types.find((item) => item.id === row.room_type_id);
    const detail =
      type === undefined
        ? { candidates: [], affectedBookingIds: [], ladderPreview: fallbackLadder() }
        : await candidatesForCase(this.db, facts, type, row.date, Number(row.shortage_count), now);
    return {
      view: {
        id: row.id,
        propertyId: row.property_id,
        date: row.date,
        roomTypeId: row.room_type_id,
        shortageCount: Number(row.shortage_count),
        status: row.status,
        detectedAt: row.detected_at.toISOString(),
        resolveDeadline: deadline.toISOString(),
        escalatedAt: row.escalated_at?.toISOString() ?? null,
        overdue:
          row.status === 'ESCALATED' ||
          (row.status !== 'RESOLVED' && now.getTime() >= deadline.getTime()),
        resolvedAt: row.resolved_at?.toISOString() ?? null,
        resolvedBy: row.resolved_by,
        resolutionSource: row.resolution_source,
        delayReason: row.delay_reason,
        affectedBookingIds: detail.affectedBookingIds,
        ladderPreview: detail.ladderPreview,
        version: Number(row.version),
      },
      candidates: detail.candidates,
    };
  }

  private scopeFor(actor: AuthorizedActor): Prisma.overbooking_casesWhereInput {
    return actor.isOwner()
      ? {}
      : { property_id: { in: [...(actor.role === 'SYSADMIN' ? [] : actor.propertyScope)] } };
  }

  private scanScope(actor: AuthorizedActor, propertyId: string | undefined) {
    if (propertyId !== undefined) return [propertyId];
    return actor.isOwner() ? undefined : [...actor.propertyScope];
  }

  private caseWhere(actor: AuthorizedActor, query: CaseQuery): Prisma.overbooking_casesWhereInput {
    const filters: Prisma.overbooking_casesWhereInput[] = [this.scopeFor(actor)];
    if (query.propertyId !== undefined) filters.push({ property_id: query.propertyId });
    if (query.status !== undefined) filters.push({ status: query.status });
    if (query.roomTypeId !== undefined) filters.push({ room_type_id: query.roomTypeId });
    if (query.dateFrom !== undefined)
      filters.push({ date: { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } });
    if (query.dateTo !== undefined)
      filters.push({ date: { lte: new Date(`${query.dateTo}T00:00:00.000Z`) } });
    return { AND: filters };
  }

  private paginate(items: readonly SummaryResult[], query: CaseQuery) {
    const start =
      query.cursor === undefined ? 0 : this.indexAfter(items, decodeCursor(query.cursor));
    const end = start + query.limit;
    const page = items.slice(start, end);
    const last = page.at(-1);
    const hasMore = end < items.length;
    return {
      page,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ date: last.view.date, id: last.view.id })
          : null,
    };
  }

  async list(actor: AuthorizedActor, query: CaseQuery) {
    if (query.propertyId !== undefined) requireProperty(actor, query.propertyId);
    const rows = await this.db.overbooking_cases.findMany({
      where: this.caseWhere(actor, query),
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: caseSelect,
    });
    const now = this.clock.now();
    const cache = new Map<string, PropertyFacts>();
    const summaries = await Promise.all(
      rows.map((row) => this.summarize(toCaseRow(row), now, cache)),
    );
    const overdueCount = summaries.filter((item) => item.view.overdue).length;
    const filtered =
      query.overdueOnly === true ? summaries.filter((item) => item.view.overdue) : summaries;
    const { page, hasMore, nextCursor } = this.paginate(filtered, query);
    return {
      data: page.map((item) => item.view),
      meta: {
        limit: query.limit,
        nextCursor,
        hasMore,
        overdueCount,
        scan: await scanMeta(this.db, this.scanScope(actor, query.propertyId)),
      },
    };
  }

  private indexAfter(items: readonly SummaryResult[], cursor: CaseCursor): number {
    const index = items.findIndex(
      (item) => item.view.date === cursor.date && item.view.id === cursor.id,
    );
    return index < 0 ? 0 : index + 1;
  }

  async detail(actor: AuthorizedActor, caseId: string, includeCandidates: boolean) {
    const row = await this.db.overbooking_cases.findUnique({
      where: { id: caseId },
      select: caseSelect,
    });
    if (row === null) throw notFound();
    const mapped = toCaseRow(row);
    requireProperty(actor, mapped.property_id);
    const summary = await this.summarize(mapped, this.clock.now(), new Map());
    return {
      ...summary.view,
      candidates: includeCandidates ? await detailCandidates(this.db, summary.candidates) : [],
      history: historyOf(mapped),
    } satisfies CaseDetail;
  }

  async alerts(actor: AuthorizedActor, query: AlertQuery) {
    if (query.propertyId !== undefined) requireProperty(actor, query.propertyId);
    const where: Prisma.overbooking_casesWhereInput = {
      AND: [
        this.scopeFor(actor),
        { status: { in: ['OPEN', 'PROPOSED', 'ESCALATED'] } },
        ...(query.propertyId === undefined ? [] : [{ property_id: query.propertyId }]),
        ...(query.date === undefined ? [] : [{ date: new Date(`${query.date}T00:00:00.000Z`) }]),
      ],
    };
    const rows = await this.db.overbooking_cases.findMany({
      where,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: caseSelect,
    });
    const now = this.clock.now();
    const cache = new Map<string, PropertyFacts>();
    const alerts: AlertItemView[] = [];
    for (const row of rows) {
      const mapped = toCaseRow(row);
      const summary = await this.summarize(mapped, now, cache);
      if (query.overdueOnly === true && !summary.view.overdue) continue;
      for (const bookingId of summary.view.affectedBookingIds)
        alerts.push({
          caseId: mapped.id,
          bookingId,
          propertyId: mapped.property_id,
          roomTypeId: mapped.room_type_id,
          date: mapped.date,
          status: summary.view.status,
          overdue: summary.view.overdue,
          label: `Thiếu ${Number(mapped.shortage_count)} phòng ngày ${mapped.date}`,
          deepLink: `/bookings/${bookingId}?overbookingCaseId=${mapped.id}`,
        });
    }
    const page = alerts.slice(0, query.limit);
    return {
      data: page,
      meta: {
        limit: query.limit,
        nextCursor: null,
        hasMore: alerts.length > query.limit,
      },
    };
  }
}
