/**
 * Lưới tồn phòng theo ngày (SCR-24, UC-INV-01) — phần thuần, kiểm được bằng vitest.
 * Suy số liệu hiển thị **thẳng** từ ô máy chủ trả (api.md §3.9, HB-035 AC1):
 * tồn công bố `max(0, pool)`, `pool` nội bộ được âm. Không áp quy tắc giá/chính sách nào ở đây.
 */

/** Trần khoảng lưới theo `inventoryGridQuerySchema` (31 ngày). */
export const MAX_GRID_DAYS = 31;

export interface GridCellNumbers {
  supply: number;
  demand: number;
  pool: number;
  blocked: number;
}

/** Tồn công bố theo BR-INV-01: `pool` có thể âm nhưng tồn bán được không âm. */
export function publishedAvailability(cell: GridCellNumbers): number {
  return Math.max(0, cell.pool);
}

export type CellStatus = 'available' | 'held' | 'blocked' | 'oversold';

/** Trạng thái ô để tô màu kèm ký hiệu chữ (thông tin không chỉ truyền bằng màu — UI-06). */
export function cellStatus(cell: GridCellNumbers): CellStatus {
  if (cell.pool < 0) return 'oversold';
  if (cell.pool === 0) return cell.blocked > 0 ? 'blocked' : 'held';
  return 'available';
}

export interface GridRange {
  from: string;
  to: string;
}

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

/** Khoảng mặc định của màn hình: `days` ngày kể từ ngày nghiệp vụ hiện tại (đồng hồ tiêm được). */
export function defaultRange(now: Date, days = 7): GridRange {
  const from = businessDate(now);
  return { from, to: addDays(from, days - 1) };
}

export function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Số ngày trong khoảng, tính cả hai đầu. */
export function dayCount(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

export function validCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const at = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === date;
}

/** Danh sách ngày của lưới; rỗng khi khoảng sai để màn hình báo theo trường. */
export function gridDates(from: string, to: string): readonly string[] {
  const total = dayCount(from, to);
  if (!validCalendarDate(from) || !validCalendarDate(to)) return [];
  if (!Number.isSafeInteger(total) || total < 1 || total > MAX_GRID_DAYS) return [];
  return Array.from({ length: total }, (_, index) => addDays(from, index));
}

export interface CellPosition {
  row: number;
  col: number;
}

export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Ô kế tiếp khi đi bằng bàn phím (lưới ARIA): giữ trong biên, `Home`/`End` về đầu/cuối hàng.
 */
export function nextCellIndex(
  current: CellPosition,
  key: GridKey,
  rows: number,
  cols: number,
): CellPosition {
  if (rows < 1 || cols < 1) return { row: 0, col: 0 };
  const row = clamp(current.row, 0, rows - 1);
  const col = clamp(current.col, 0, cols - 1);
  switch (key) {
    case 'ArrowLeft':
      return { row, col: clamp(col - 1, 0, cols - 1) };
    case 'ArrowRight':
      return { row, col: clamp(col + 1, 0, cols - 1) };
    case 'ArrowUp':
      return { row: clamp(row - 1, 0, rows - 1), col };
    case 'ArrowDown':
      return { row: clamp(row + 1, 0, rows - 1), col };
    case 'Home':
      return { row, col: 0 };
    default:
      return { row, col: cols - 1 };
  }
}

export function cellKey(position: CellPosition): string {
  return `${position.row}-${position.col}`;
}
