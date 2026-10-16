/**
 * Bảng mã mùa của BR-RATE-05 §4.2 — dùng để **suy ra** `seasons.code` cho mùa do API tạo.
 *
 * Hợp đồng HB-050 (`seasonCreateRequestSchema`) không có trường `code`, màn SCR-27 cũng không quản nó,
 * nhưng `seasons.code` là `NOT NULL` với CHECK đúng 7 mã. Mã này **không** tham gia tính giá (engine
 * HB-052 chỉ dùng khoảng ngày, `priority`, hệ số) và không được trả ra API, nên máy chủ lấy cửa sổ năm
 * của chính bảng §4.2 làm nhãn: mùa tạo cho đêm lễ/hè nào thì mang mã của cửa sổ chứa `startDate`.
 */
export type SeasonCode = 'SE-NY' | 'SE-TET' | 'SE-REUN' | 'SE-NAT' | 'SE-SUM' | 'SE-SHO' | 'SE-LOW';

interface SeasonWindow {
  readonly code: SeasonCode;
  readonly from: string;
  readonly to: string;
  /** Thứ tự ưu tiên của bảng §4.2 — dùng khi hai cửa sổ cùng chứa ngày bắt đầu (SE-NAT nằm trong SE-SHO). */
  readonly priority: number;
  readonly wrap?: true;
}

const WINDOWS: readonly SeasonWindow[] = [
  { code: 'SE-NY', from: '12-30', to: '01-02', priority: 90, wrap: true },
  // SE-TET theo âm lịch nên bảng §4.2 không ghim cửa sổ; đây là khoảng duy nhất còn trống của năm.
  { code: 'SE-TET', from: '01-03', to: '04-27', priority: 90 },
  { code: 'SE-REUN', from: '04-28', to: '05-03', priority: 80 },
  { code: 'SE-NAT', from: '08-31', to: '09-03', priority: 80 },
  { code: 'SE-SUM', from: '06-01', to: '08-15', priority: 50 },
  { code: 'SE-SHO', from: '08-16', to: '09-30', priority: 30 },
  { code: 'SE-LOW', from: '10-01', to: '12-29', priority: 20 },
];

/** Ngày ngoài mọi cửa sổ §4.2 (04/05–31/05 không thuộc mùa lễ/hè nào) gom về nhãn thấp điểm. */
const FALLBACK_CODE: SeasonCode = 'SE-LOW';

function inside(window: SeasonWindow, monthDay: string): boolean {
  return window.wrap === true
    ? monthDay >= window.from || monthDay <= window.to
    : monthDay >= window.from && monthDay <= window.to;
}

export function seasonCodeFor(startDate: string): SeasonCode {
  const monthDay = startDate.slice(5);
  const matches = WINDOWS.filter((window) => inside(window, monthDay)).sort(
    (a, b) => b.priority - a.priority,
  );
  return matches[0]?.code ?? FALLBACK_CODE;
}
