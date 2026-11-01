/**
 * Hành vi HTTP dùng chung cho bộ test khoá OVER (HB-124): đề xuất/đọc/duyệt/thực thi.
 * Mọi hàm đều chốt "đỏ vì thiếu hành vi" trước assertion nghiệp vụ để F6-D05 không bị lẫn lỗi fixture.
 */
import { expect } from 'vitest';
import { guardRoute, post } from './harness.js';
import { mergeViewSchema, moveViewSchema, type MergeView, type MoveView } from './views.js';

export const MOVES = '/api/v1/room-moves';
export const MERGES = '/api/v1/room-merges';
export const REFUNDS = '/api/v1/refund-requests';

export const moveBody = (
  bookingId: string,
  bookingRoomId: string,
  toRoomId: string,
  extra: object = {},
) => ({
  bookingId,
  bookingRoomId,
  moveType: 'SAME_TYPE_SAME_PROPERTY',
  toRoomId,
  reason: 'Quá tải loại STD đêm cao điểm',
  compensationAmount: 0,
  transportCost: 0,
  ...extra,
});

export async function proposeMove(token: string, body: object): Promise<MoveView> {
  const response = await post(MOVES, token, body);
  guardRoute(response, 'POST /room-moves');
  expect(response.status).toBe(201);
  return moveViewSchema.parse(response.body);
}

export async function proposeMerge(token: string, body: object): Promise<MergeView> {
  const response = await post(MERGES, token, body);
  guardRoute(response, 'POST /room-merges');
  expect(response.status).toBe(201);
  return mergeViewSchema.parse(response.body);
}

export const executeMove = (id: string, token: string, pinToken: string, tag?: string) =>
  post(`${MOVES}/${id}/execute`, token, { pinToken }, tag === undefined ? {} : { tag });

export const approveMove = (id: string, token: string, body: object) =>
  post(`${MOVES}/${id}/approve`, token, body);
