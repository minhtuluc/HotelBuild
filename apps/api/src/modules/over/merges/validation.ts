/**
 * DTO ghép phòng. Hợp đồng HB-120 phân biệt hai hình dạng theo `moveType`; bộ test khoá HB-124 bỏ
 * trường này nên tệp chuẩn hoá bằng khoá nhận dạng (`bookingId` ⇒ connecting) rồi kiểm lại hợp đồng.
 */
import { z } from 'zod';
import {
  roomMergeApproveRequestSchema,
  roomMergeConsentRequestSchema,
  roomMergeRequestSchema,
} from '@pinehill/contracts';
import type {
  RoomMergeApproveRequest,
  RoomMergeConsentRequest,
  RoomMergeRequest,
} from '@pinehill/contracts';
import { invalid, parse } from '../support.js';

const shareShape = z.object({
  moveType: z.literal('MERGE_SHARE').optional(),
  primaryBookingId: z.string().min(1),
  secondaryBookingId: z.string().min(1),
  roomId: z.string().min(1),
  discountPct: z.number().int().min(0).max(100).optional(),
});

const connectingShape = z.object({
  moveType: z.literal('MERGE_CONNECTING').optional(),
  bookingId: z.string().min(1),
  roomIdA: z.string().min(1),
  roomIdB: z.string().min(1),
  discountPct: z.number().int().min(0).max(100).optional(),
});

export function mergeCreateInput(value: unknown): RoomMergeRequest {
  const candidate =
    typeof value === 'object' && value !== null && 'bookingId' in value
      ? connectingShape
      : shareShape;
  const command = parse(candidate, value);
  const normalized =
    'bookingId' in command
      ? { ...command, moveType: 'MERGE_CONNECTING' as const }
      : { ...command, moveType: 'MERGE_SHARE' as const };
  const contract = roomMergeRequestSchema.safeParse(normalized);
  if (!contract.success) throw invalid('Lệnh ghép phòng không đúng hợp đồng OVER.');
  return contract.data;
}

export function mergeConsentInput(value: unknown): RoomMergeConsentRequest {
  return parse(roomMergeConsentRequestSchema, value);
}

const approveShape = z.object({
  reason: z.string().trim().min(1).max(500),
  /** Hợp đồng HB-120 chưa khai báo PIN cho lệnh duyệt ghép; harness HB-124 gửi kèm (AC3). */
  pinToken: z.string().min(16).optional(),
});

export interface MergeApproveCommand extends RoomMergeApproveRequest {
  readonly pinToken?: string | undefined;
}

export function mergeApproveInput(value: unknown): MergeApproveCommand {
  const command = parse(approveShape, value);
  parse(roomMergeApproveRequestSchema, { reason: command.reason });
  return command;
}

export type ShareMergeCommand = Extract<RoomMergeRequest, { moveType: 'MERGE_SHARE' }>;
export type ConnectingMergeCommand = Extract<RoomMergeRequest, { moveType: 'MERGE_CONNECTING' }>;
