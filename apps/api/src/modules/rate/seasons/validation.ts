/**
 * Kiểm đầu vào mùa (UC-RATE-02). Khoảng ngày phải hợp lệ, hệ số trong giới hạn hợp đồng (0,10–5,00),
 * `priority` nằm trong `smallint`; **chồng lấn được phép** — chọn mùa thắng là việc của engine HB-052.
 */
import {
  seasonCreateRequestSchema,
  seasonQuerySchema,
  seasonUpdateRequestSchema,
  type SeasonQuery,
  type SeasonUpdateRequest,
} from '@pinehill/contracts';
import { seasonCodeFor } from './catalogue.js';
import type { SeasonCode } from './catalogue.js';
import {
  civilDay,
  configuration,
  configurationAll,
  invalid,
  isCivilDate,
  maskText,
  uuid,
} from '../calendar/support.js';
import type { Issue } from '../calendar/support.js';

/** `seasons.priority` là `smallint` (csdl §3) — giá trị lớn hơn làm CSDL tràn số. */
const MAX_PRIORITY = 32767;

/** `seasons.multiplier` là `numeric(5,3)`: hệ số có quá 3 chữ số thập phân sẽ bị CSDL làm tròn im lặng. */
const MULTIPLIER_SCALE_TOLERANCE = 1e-6;

export interface SeasonCreateInput {
  readonly propertyId: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly multiplier: number;
  readonly priority: number;
  readonly weekendSurchargeEnabled: boolean;
  readonly code: SeasonCode;
}

export function listQuery(value: unknown): SeasonQuery {
  const parsed = seasonQuerySchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const { from, to, propertyId, cursor } = parsed.data;
  if (from !== undefined) civilDay(from);
  if (to !== undefined) civilDay(to);
  if (from !== undefined && to !== undefined && from > to) throw invalid();
  return {
    ...parsed.data,
    ...(propertyId === undefined ? {} : { propertyId: uuid(propertyId) }),
    // `seasonQuerySchema` chỉ bắt `cursor` khác rỗng; tuyến này so trực tiếp với `id` uuid.
    ...(cursor === undefined ? {} : { cursor: uuid(cursor) }),
  };
}

/** Hệ số vượt 3 chữ số thập phân sẽ bị `numeric(5,3)` làm tròn im lặng — chặn từ đầu. */
function exceedsStorageScale(multiplier: number): boolean {
  return Math.abs(Math.round(multiplier * 1000) - multiplier * 1000) > MULTIPLIER_SCALE_TOLERANCE;
}

/** Phần dữ liệu mùa mà luật kiểm (dùng chung cho tạo và bản gộp khi sửa). */
export interface SeasonTerms {
  readonly startDate: string;
  readonly endDate: string;
  readonly multiplier: number;
  readonly priority: number;
}

export function seasonIssues(data: SeasonTerms, name: string): readonly Issue[] {
  const issues: Issue[] = [];
  if (name === '') issues.push({ field: 'name', issue: 'REQUIRED' });
  if (!isCivilDate(data.startDate)) issues.push({ field: 'startDate', issue: 'INVALID_DATE' });
  else if (!isCivilDate(data.endDate)) issues.push({ field: 'endDate', issue: 'INVALID_DATE' });
  else if (data.endDate < data.startDate) issues.push({ field: 'endDate', issue: 'BEFORE_START' });
  if (data.priority > MAX_PRIORITY) issues.push({ field: 'priority', issue: 'OUT_OF_RANGE' });
  if (exceedsStorageScale(data.multiplier))
    issues.push({ field: 'multiplier', issue: 'SCALE_EXCEEDS_3' });
  return issues;
}

export function createInput(value: unknown): SeasonCreateInput {
  const parsed = seasonCreateRequestSchema.safeParse(value);
  if (!parsed.success)
    configuration(parsed.error.issues[0]?.path.join('.') || 'request', 'INVALID_VALUE');
  const data = parsed.data,
    name = data.name.trim(),
    issues = seasonIssues(data, name);
  if (issues.length > 0) configurationAll(issues);
  return {
    propertyId: uuid(data.propertyId),
    name: maskText(name),
    startDate: data.startDate,
    endDate: data.endDate,
    multiplier: data.multiplier,
    priority: data.priority,
    weekendSurchargeEnabled: data.weekendSurchargeEnabled,
    code: seasonCodeFor(data.startDate),
  };
}

/** Trường sửa được (HB-241, TD-06); `name` đã che PII như lệnh tạo. */
export interface SeasonChanges {
  readonly name?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly multiplier?: number;
  readonly priority?: number;
  readonly weekendSurchargeEnabled?: boolean;
  readonly status?: 'ACTIVE' | 'INACTIVE';
}

export interface SeasonUpdateInput {
  readonly changes: SeasonChanges;
  readonly reason: string;
}

export function updateInput(value: unknown): SeasonUpdateInput {
  const parsed = seasonUpdateRequestSchema.safeParse(value);
  if (!parsed.success)
    configuration(parsed.error.issues[0]?.path.join('.') || 'request', 'INVALID_VALUE');
  const reason = parsed.data.reason.trim();
  if (reason === '') configuration('reason', 'REQUIRED');
  return { changes: { ...nameChange(parsed.data), ...termChanges(parsed.data) }, reason };
}

function nameChange(body: SeasonUpdateRequest): SeasonChanges {
  if (body.name === undefined) return {};
  const name = body.name.trim();
  if (name === '') configuration('name', 'REQUIRED');
  return { name: maskText(name) };
}

function termChanges(body: SeasonUpdateRequest): SeasonChanges {
  return {
    ...(body.startDate === undefined ? {} : { startDate: body.startDate }),
    ...(body.endDate === undefined ? {} : { endDate: body.endDate }),
    ...(body.multiplier === undefined ? {} : { multiplier: body.multiplier }),
    ...(body.priority === undefined ? {} : { priority: body.priority }),
    ...(body.weekendSurchargeEnabled === undefined
      ? {}
      : { weekendSurchargeEnabled: body.weekendSurchargeEnabled }),
    ...(body.status === undefined ? {} : { status: body.status }),
  };
}
