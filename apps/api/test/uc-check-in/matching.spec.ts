import { expect, test } from 'vitest';
import { matchRoomsToUnits } from '../../src/modules/fo/check-in/matching.js';

const units = ['u1', 'u2', 'u3'];
const roomsOf = (result: ReturnType<typeof matchRoomsToUnits>) => result.map((row) => row.roomId);

test('mọi hoán vị của cùng tập phòng cho cùng một cách ghép (chưa có assignment)', () => {
  const sets = [
    ['r1', 'r2', 'r3'],
    ['r3', 'r2', 'r1'],
    ['r2', 'r3', 'r1'],
  ];
  for (const set of sets)
    expect(roomsOf(matchRoomsToUnits(units, new Map(), set))).toEqual(['r1', 'r2', 'r3']);
});

test('đơn vị đã giữ phòng thuộc tập chọn thì giữ nguyên, phần còn lại ghép theo thứ tự id', () => {
  const current = new Map([
    ['u1', 'r9'],
    ['u3', 'r2'],
  ]);
  expect(matchRoomsToUnits(units, current, ['r2', 'r5', 'r9'])).toEqual([
    { bookingRoomId: 'u1', roomId: 'r9' },
    { bookingRoomId: 'u2', roomId: 'r5' },
    { bookingRoomId: 'u3', roomId: 'r2' },
  ]);
});

test('phòng đang giữ nhưng không được chọn thì bị thay bằng phòng mới', () => {
  const current = new Map([['u1', 'r1']]);
  expect(matchRoomsToUnits(['u1'], current, ['r7'])).toEqual([
    { bookingRoomId: 'u1', roomId: 'r7' },
  ]);
});
