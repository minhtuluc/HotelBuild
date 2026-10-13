/**
 * SCR-22 — khoá phòng (UC-PROP-04, BR-INV-06): phần thuần kiểm được bằng vitest.
 * Cảnh báo chồng lấn ở giao diện **chỉ để nhắc**; máy chủ (HB-034) vẫn là nơi chặn (BR-PROP-06).
 */
import {
  businessDateSchema,
  type RoomBlock,
  type RoomBlockCreateRequest,
} from '@pinehill/contracts';

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

/** Calendar syntax mirrors the established HTTP boundary; inventory remains server owned. */
export function validBlockDate(value: string): boolean {
  if (!businessDateSchema.safeParse(value).success) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Published API/CSDL use [start, end): adjoining nights and empty intervals do not overlap. */
export function overlaps(a: { startDate: string; endDate: string }, b: RoomBlock): boolean {
  return (
    a.startDate < a.endDate &&
    b.startDate < b.endDate &&
    a.startDate < b.endDate &&
    b.startDate < a.endDate
  );
}

/** Các khoá đã có của cùng phòng giao với khoảng đang nhập — dùng để cảnh báo trước khi gửi. */
export function conflictingBlocks(
  draft: Pick<RoomBlockDraft, 'roomId' | 'startDate' | 'endDate'>,
  blocks: readonly RoomBlock[],
): readonly RoomBlock[] {
  if (draft.roomId === '' || !validBlockDate(draft.startDate) || !validBlockDate(draft.endDate))
    return [];
  return blocks.filter((block) => block.roomId === draft.roomId && overlaps(draft, block));
}

/** Reject malformed/empty transport ranges before sending to the authoritative API. */
export function validateDraft(draft: RoomBlockDraft): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (draft.roomId === '') issues.push({ field: 'roomId', issue: 'REQUIRED' });
  for (const field of ['startDate', 'endDate'] as const) {
    if (draft[field] === '') issues.push({ field, issue: 'REQUIRED' });
    else if (!validBlockDate(draft[field])) issues.push({ field, issue: 'INVALID' });
  }
  if (
    validBlockDate(draft.startDate) &&
    validBlockDate(draft.endDate) &&
    draft.endDate <= draft.startDate
  ) {
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
