/**
 * SCR-27 — mùa & hệ số (UC-RATE-02, BR-RATE-05,06): phần thuần kiểm được bằng vitest.
 * Mùa chồng nhau **được phép**; chọn mùa thắng là của máy chủ (engine HB-052) — giao diện chỉ
 * hiển thị `source`/`seasonName` do `GET rate-calendar` trả, **không** tự so `priority`.
 */
import type { RateCalendar, SeasonCreateRequest } from '@pinehill/contracts';

/** Một ngày trong lịch giá do `GET rate-calendar` trả (kiểu suy từ hợp đồng, không khai lại). */
export type RateCalendarEntry = RateCalendar['entries'][number];

export interface SeasonDraft {
  propertyId: string;
  roomTypeId: string;
  name: string;
  startDate: string;
  endDate: string;
  /** Giữ dạng chuỗi để kiểm định dạng trước khi đổi sang số (tránh `NaN` lọt xuống hợp đồng). */
  multiplier: string;
  priority: string;
  weekendSurchargeEnabled: boolean;
}

export const EMPTY_SEASON_DRAFT: SeasonDraft = {
  propertyId: '',
  roomTypeId: '',
  name: '',
  startDate: '',
  endDate: '',
  multiplier: '1.00',
  priority: '0',
  weekendSurchargeEnabled: false,
};

export interface FieldIssue {
  field: string;
  issue: string;
}

/** Hệ số hợp lệ theo hợp đồng `rate.ts` (0,10–5,00). */
export const MULTIPLIER_MIN = 0.1;
export const MULTIPLIER_MAX = 5;

/** Trường bắt buộc phải khác rỗng, theo thứ tự khai báo (thông điệp lỗi ổn định cho test). */
const REQUIRED_FIELDS: readonly (keyof SeasonDraft)[] = [
  'propertyId',
  'roomTypeId',
  'name',
  'startDate',
  'endDate',
];

function requiredIssues(draft: SeasonDraft): readonly FieldIssue[] {
  return REQUIRED_FIELDS.filter((field) => String(draft[field]).trim() === '').map((field) => ({
    field,
    issue: 'REQUIRED',
  }));
}

function rangeIssues(draft: SeasonDraft): readonly FieldIssue[] {
  if (draft.startDate === '' || draft.endDate === '') return [];
  return draft.endDate < draft.startDate ? [{ field: 'endDate', issue: 'BEFORE_START' }] : [];
}

function numberIssues(draft: SeasonDraft): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  const multiplier = parseMultiplier(draft.multiplier);
  if (multiplier === null || multiplier < MULTIPLIER_MIN || multiplier > MULTIPLIER_MAX) {
    issues.push({ field: 'multiplier', issue: 'OUT_OF_RANGE' });
  }
  if (parsePriority(draft.priority) === null) {
    issues.push({ field: 'priority', issue: 'NOT_INTEGER' });
  }
  return issues;
}

/** Chặn tại chỗ trước khi gọi API; hệ số chấp nhận dấu phẩy thập phân kiểu Việt Nam. */
export function validateSeasonDraft(draft: SeasonDraft): readonly FieldIssue[] {
  return [...requiredIssues(draft), ...rangeIssues(draft), ...numberIssues(draft)];
}

/** `1,25` → `1.25`; trả `null` khi không phải số hữu hạn. */
export function parseMultiplier(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Ưu tiên là số nguyên ≥ 0 (api.md §2.4). */
export function parsePriority(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

export function toCreateRequest(draft: SeasonDraft): SeasonCreateRequest {
  const multiplier = parseMultiplier(draft.multiplier);
  const priority = parsePriority(draft.priority);
  if (multiplier === null || priority === null) {
    throw new RangeError('Bản nhập mùa chưa qua kiểm tra (multiplier/priority).');
  }
  return {
    propertyId: draft.propertyId,
    name: draft.name.trim(),
    startDate: draft.startDate,
    endDate: draft.endDate,
    multiplier,
    priority,
    weekendSurchargeEnabled: draft.weekendSurchargeEnabled,
  };
}

export interface CalendarRow {
  date: string;
  nightlyPrice: number;
  source: RateCalendarEntry['source'];
  seasonName: string | null;
}

/** Dòng hiển thị lấy **nguyên** từ phản hồi máy chủ — không nội suy, không tự chọn mùa thắng. */
export function calendarRows(entries: readonly RateCalendarEntry[]): readonly CalendarRow[] {
  return entries.map((entry) => ({
    date: entry.date,
    nightlyPrice: entry.nightlyPrice,
    source: entry.source,
    seasonName: entry.seasonName ?? null,
  }));
}

/**
 * Tên các mùa đang thắng trên khoảng đang nhập, **trừ** tên mùa đang tạo — dùng cho cảnh báo chồng
 * lấn (BR-RATE-05: chồng lấn được phép, chỉ nhắc). Nguồn duy nhất là `GET rate-calendar`.
 */
export function overlappingSeasonNames(
  entries: readonly RateCalendarEntry[],
  draftName: string,
): readonly string[] {
  const names: string[] = [];
  const wanted = draftName.trim();
  for (const entry of entries) {
    if (entry.source !== 'SEASON') continue;
    const name = entry.seasonName;
    if (name === undefined || name === wanted) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
