/**
 * SCR-22 — khoá phòng (UC-PROP-04, BR-INV-06): phần thuần kiểm được bằng vitest.
 * Cảnh báo chồng lấn ở giao diện **chỉ để nhắc**; máy chủ (HB-034) vẫn là nơi chặn (BR-PROP-06).
 */
import type { RoomBlock, RoomBlockCreateRequest } from '@pinehill/contracts';

export interface RoomBlockDraft {
  roomId: string;
  startDate: string;
  endDate: string;
  reason: RoomBlock['reason'];
  note: string;
}

export const EMPTY_ROOM_BLOCK_DRAFT: RoomBlockDraft = {
  roomId: '',
  startDate: '',
  endDate: '',
  reason: 'MAINTENANCE',
  note: '',
};

export interface FieldIssue {
  field: string;
  issue: string;
}

export const ROOM_BLOCK_REASONS = [
  'MAINTENANCE',
  'RENOVATION',
  'OWNER_USE',
  'DEEP_CLEAN',
] as const satisfies readonly RoomBlock['reason'][];

/** Thu hẹp giá trị `<select>` về enum lý do của hợp đồng mà không cần ép kiểu. */
export function isRoomBlockReason(value: string): value is RoomBlock['reason'] {
  return ROOM_BLOCK_REASONS.some((reason) => reason === value);
}

/** Chồng lấn tính **cả hai biên**: khoá là "ngừng bán trong ngày" nên `[start, end]` giao nhau khi chạm mép. */
export function overlaps(a: { startDate: string; endDate: string }, b: RoomBlock): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** Các khoá đã có của cùng phòng giao với khoảng đang nhập — dùng để cảnh báo trước khi gửi. */
export function conflictingBlocks(
  draft: Pick<RoomBlockDraft, 'roomId' | 'startDate' | 'endDate'>,
  blocks: readonly RoomBlock[],
): readonly RoomBlock[] {
  if (draft.roomId === '' || draft.startDate === '' || draft.endDate === '') return [];
  return blocks.filter((block) => block.roomId === draft.roomId && overlaps(draft, block));
}

/** Chặn tại chỗ khi thiếu phòng/ngày hoặc `endDate < startDate` (không gọi API). */
export function validateDraft(draft: RoomBlockDraft): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (draft.roomId === '') issues.push({ field: 'roomId', issue: 'REQUIRED' });
  if (draft.startDate === '') issues.push({ field: 'startDate', issue: 'REQUIRED' });
  if (draft.endDate === '') issues.push({ field: 'endDate', issue: 'REQUIRED' });
  if (draft.startDate !== '' && draft.endDate !== '' && draft.endDate < draft.startDate) {
    issues.push({ field: 'endDate', issue: 'BEFORE_START' });
  }
  return issues;
}

/** Thân `POST /room-blocks`: bỏ `note` khi để trống (hợp đồng cho phép vắng). */
export function toCreateRequest(draft: RoomBlockDraft): RoomBlockCreateRequest {
  return {
    roomId: draft.roomId,
    startDate: draft.startDate,
    endDate: draft.endDate,
    reason: draft.reason,
    ...(draft.note.trim() === '' ? {} : { note: draft.note.trim() }),
  };
}
