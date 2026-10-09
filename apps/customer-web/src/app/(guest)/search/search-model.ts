/**
 * SCR-01 — phần thuần của khối tìm phòng (UC-INV-02): mặc định ngày, kiểm tại chỗ và dựng truy vấn tìm.
 * Không gọi API ở đây; ngày tính theo giờ VN để khớp ngày nghiệp vụ của máy chủ.
 */

export interface SearchDraft {
  readonly propertyId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: string;
  readonly children: string;
}

export interface FieldIssue {
  readonly field: string;
  readonly issue: string;
}

/** Giới hạn nhập tại chỗ: 1–10 người lớn, 0–6 trẻ em (máy chủ vẫn là nơi chặn cuối). */
export const MAX_ADULTS = 10;
export const MAX_CHILDREN = 6;

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Ngày nghiệp vụ (giờ VN) của một mốc thời gian — `YYYY-MM-DD`. */
export function businessDate(instant: Date): string {
  return DATE_FORMATTER.format(instant);
}

export function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Mặc định: nhận phòng hôm nay, trả phòng hôm sau, 2 người lớn, không trẻ em. */
export function defaultDraft(now: Date): SearchDraft {
  const checkIn = businessDate(now);
  return {
    propertyId: '',
    checkIn,
    checkOut: addDays(checkIn, 1),
    adults: '2',
    children: '0',
  };
}

function parseCount(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max;
}

/** Kiểm tại chỗ trước khi gửi: cơ sở, kỳ ít nhất một đêm, số khách trong khoảng hợp đồng. */
export function validateSearch(draft: SearchDraft): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (draft.propertyId.trim() === '') issues.push({ field: 'propertyId', issue: 'REQUIRED' });
  if (draft.checkIn.trim() === '') issues.push({ field: 'checkIn', issue: 'REQUIRED' });
  if (draft.checkOut.trim() === '') issues.push({ field: 'checkOut', issue: 'REQUIRED' });
  if (
    draft.checkIn.trim() !== '' &&
    draft.checkOut.trim() !== '' &&
    Date.parse(`${draft.checkOut}T00:00:00Z`) <= Date.parse(`${draft.checkIn}T00:00:00Z`)
  ) {
    issues.push({ field: 'checkOut', issue: 'BEFORE_START' });
  }
  if (!parseCount(draft.adults, 1, MAX_ADULTS))
    issues.push({ field: 'adults', issue: 'OUT_OF_RANGE' });
  if (!parseCount(draft.children, 0, MAX_CHILDREN)) {
    issues.push({ field: 'children', issue: 'OUT_OF_RANGE' });
  }
  return issues;
}

/** Truy vấn tìm phòng cho SCR-02 — chỉ những trường hợp đồng `availabilityQuerySchema` khai. */
export function searchQuery(draft: SearchDraft): URLSearchParams {
  return new URLSearchParams({
    propertyId: draft.propertyId.trim(),
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    adults: String(Number(draft.adults)),
    children: String(Number(draft.children)),
  });
}

export function searchHref(draft: SearchDraft): string {
  return `/search?${searchQuery(draft).toString()}`;
}
