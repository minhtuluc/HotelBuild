import type {
  DayBoard,
  DayBoardBooking,
  InventoryGrid,
  InventoryRoomTypeGrid,
  RoomTypeSummary,
} from '@pinehill/contracts';
import { businessDate, publishedAvailability } from '../../../lib/inventory-grid';

export interface DayRow {
  roomTypeId: string;
  code: string;
  unit: 'beds' | 'rooms';
  available: number;
}
export interface DayData {
  propertyId: string;
  date: string;
  capturedAt: string | null;
  rows: readonly DayRow[];
  properties: readonly { id: string; name: string }[];
  /** HB-309: đến/đi/ở, ca quá tải, kênh suy giảm (`GET /operations/day-board`); `null` khi chưa tải được. */
  board?: DayBoard | null;
  /** Lỗi riêng của phần bảng ngày; phần tồn khả dụng vẫn hiện. */
  boardError?: unknown;
}
export function defaultDay(now: Date): string {
  return businessDate(now);
}
export function validDay(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const at = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === date;
}
export function projectDayBoard(
  propertyId: string,
  date: string,
  types: readonly RoomTypeSummary[],
  grid: InventoryGrid,
): Omit<DayData, 'properties'> {
  if (grid.capturedAt && !Number.isFinite(Date.parse(grid.capturedAt)))
    throw new Error('Invalid capture timestamp');
  if (grid.propertyId !== propertyId || grid.from !== date || grid.to !== date)
    throw new Error('Mismatched inventory projection');
  const grids = grid.grids ?? [grid];
  if (
    grids.length !== types.length ||
    new Set(grids.map((item) => item.roomTypeId)).size !== grids.length
  )
    throw new Error('Incomplete inventory projection');
  const rows = types.map((type) => {
    const item = grids.find((value) => value.roomTypeId === type.id);
    if (type.propertyId !== propertyId || !item) throw new Error('Mismatched inventory row');
    const available = availableFor(item, propertyId, date);
    const unit = type.allowShared ? ('beds' as const) : ('rooms' as const);
    return { roomTypeId: type.id, code: type.code, unit, available };
  });
  return { propertyId, date, rows, capturedAt: grid.capturedAt ?? null };
}

function availableFor(item: InventoryRoomTypeGrid, propertyId: string, date: string): number {
  if (item.propertyId !== propertyId || item.from !== date || item.to !== date)
    throw new Error('Mismatched inventory row');
  const cell = item.cells[0];
  if (item.cells.length !== 1 || !cell || cell.date !== date)
    throw new Error('Missing inventory day');
  const available = cell.published ?? publishedAvailability(cell);
  if (!Number.isSafeInteger(available) || available < 0) throw new Error('Invalid inventory count');
  return available;
}

/** Bảng ngày phải đúng cơ sở và ngày đang xem; lệch là lỗi, không hiện số của ngày khác. */
export function checkBoard(board: DayBoard, propertyId: string, date: string): DayBoard {
  if (board.propertyId !== propertyId || board.date !== date)
    throw new Error('Mismatched day board');
  for (const group of [board.arrivals, board.departures, board.inHouse])
    if (group.items.length > group.total) throw new Error('Invalid day board group');
  return board;
}

/** Khách chưa làm thủ tục lên trước: đến chưa nhận (`CONFIRMED`), đi chưa trả (`CHECKED_IN`). */
const PENDING_FIRST: Readonly<Record<'arrivals' | 'departures' | 'inHouse', string>> = {
  arrivals: 'CONFIRMED',
  departures: 'CHECKED_IN',
  inHouse: 'CHECKED_IN',
};

export function orderGroup(
  kind: 'arrivals' | 'departures' | 'inHouse',
  items: readonly DayBoardBooking[],
): readonly DayBoardBooking[] {
  const first = PENDING_FIRST[kind];
  return [...items].sort(
    (a, b) =>
      Number(b.status === first) - Number(a.status === first) || a.code.localeCompare(b.code),
  );
}

/** Số khách còn phải làm thủ tục trong nhóm (chỉ đếm trên các dòng máy chủ trả). */
export function pendingCount(
  kind: 'arrivals' | 'departures',
  items: readonly DayBoardBooking[],
): number {
  return items.filter((item) => item.status === PENDING_FIRST[kind]).length;
}
