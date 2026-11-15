/**
 * Ngữ cảnh hành trình trên URL (HB-317, FEAT-01, FEAT-03): giữ cơ sở, ngày và số khách khi khách đi qua
 * lại giữa khối tìm phòng, kết quả và trang nội dung. Chỉ nằm trên URL (kế hoạch giao diện §8: không dùng
 * `sessionStorage`), mọi giá trị đều kiểm lại; giá trị sai bị bỏ, không đoán.
 */
import { addDays, MAX_ADULTS, MAX_CHILDREN, type SearchDraft } from './search-model';

/** Phần bản nháp lấy được từ URL; trường vắng hoặc sai thì không có mặt. */
export type DraftFromUrl = Partial<
  Pick<SearchDraft, 'propertyId' | 'checkIn' | 'checkOut' | 'adults' | 'children'>
>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function calendarDate(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (!ISO_DATE.test(trimmed)) return undefined;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed
    ? undefined
    : trimmed;
}

function count(value: string | null, min: number, max: number): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (!/^\d{1,2}$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed >= min && parsed <= max ? String(parsed) : undefined;
}

/**
 * Đọc ngữ cảnh từ truy vấn URL. Ngày trả chỉ giữ khi sau ngày nhận (kỳ ít nhất một đêm); `propertyId`
 * chỉ là gợi ý: khối tìm phòng vẫn chỉ nhận id có trong danh sách máy chủ trả.
 */
export function draftFromUrl(params: URLSearchParams): DraftFromUrl {
  const out: { -readonly [K in keyof DraftFromUrl]: DraftFromUrl[K] } = {};
  const propertyId = params.get('propertyId')?.trim() ?? '';
  if (ID.test(propertyId)) out.propertyId = propertyId;
  const checkIn = calendarDate(params.get('checkIn'));
  const checkOut = calendarDate(params.get('checkOut'));
  if (checkIn !== undefined) out.checkIn = checkIn;
  if (checkIn !== undefined && checkOut !== undefined && checkOut > checkIn)
    out.checkOut = checkOut;
  const adults = count(params.get('adults'), 1, MAX_ADULTS);
  if (adults !== undefined) out.adults = adults;
  const children = count(params.get('children'), 0, MAX_CHILDREN);
  if (children !== undefined) out.children = children;
  return out;
}

/** Ghép ngữ cảnh URL lên bản nháp mặc định. Có ngày nhận mà thiếu ngày trả thì trả phòng hôm sau. */
export function mergeDraft(base: SearchDraft, fromUrl: DraftFromUrl): SearchDraft {
  const checkIn = fromUrl.checkIn ?? base.checkIn;
  const checkOut =
    fromUrl.checkOut ?? (fromUrl.checkIn === undefined ? base.checkOut : addDays(checkIn, 1));
  return {
    propertyId: base.propertyId,
    checkIn,
    checkOut,
    adults: fromUrl.adults ?? base.adults,
    children: fromUrl.children ?? base.children,
  };
}

/** Các mức chọn nhanh số đêm (FEAT-03). Nhãn trung tính: không hứa mức giảm (kế hoạch giao diện §8). */
export const QUICK_NIGHTS = [2, 3, 5] as const;

/**
 * Chọn nhanh số đêm: giữ ngày nhận đang chọn (không hợp lệ hoặc trước `today` thì lấy `today`), đặt ngày
 * trả cách đó `nights` đêm. `today` là ngày nghiệp vụ giờ VN do nơi gọi truyền vào.
 */
export function withNights(draft: SearchDraft, nights: number, today: string): SearchDraft {
  const valid = calendarDate(draft.checkIn);
  const checkIn = valid === undefined || valid < today ? today : valid;
  return { ...draft, checkIn, checkOut: addDays(checkIn, nights) };
}

/** Số đêm của bản nháp nếu khớp một mức chọn nhanh (để đánh dấu nút đang chọn). */
export function activeQuickNights(draft: SearchDraft): number | null {
  const checkIn = calendarDate(draft.checkIn);
  const checkOut = calendarDate(draft.checkOut);
  if (checkIn === undefined || checkOut === undefined) return null;
  const nights = Math.round(
    (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000,
  );
  return QUICK_NIGHTS.some((value) => value === nights) ? nights : null;
}

/** `searchParams` của trang máy chủ thành `URLSearchParams`; khoá lặp lại (mảng) bị bỏ, không đoán. */
export function urlParams(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') params.set(key, value);
  }
  return params;
}
