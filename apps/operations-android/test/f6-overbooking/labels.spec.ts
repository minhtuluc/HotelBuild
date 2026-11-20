import { expect, test } from 'vitest';
import type { ListPage, RoomSummary } from '@pinehill/contracts';
import {
  actionText,
  loadPlaceNames,
  moveStatusText,
  moveTypeText,
  roomText,
  targetText,
} from '../../src/features/f6-overbooking/labels';

const room = (id: string, code: string, propertyId = 'p1'): RoomSummary => ({
  id,
  propertyId,
  roomTypeId: 'rt',
  code,
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 0,
});
const page = (data: RoomSummary[], nextCursor: string | null): ListPage<RoomSummary> => ({
  data,
  meta: { limit: 100, nextCursor, hasMore: nextCursor !== null, total: 3 },
});

test('HB-270: names load across room pages and public properties', async () => {
  const cursors: (string | undefined)[] = [];
  const names = await loadPlaceNames({
    rooms: async (cursor) => {
      cursors.push(cursor);
      return cursor === undefined
        ? page([room('r1', 'STD01'), room('r2', 'SUP01')], 'r2')
        : page([room('r3', 'B101', 'p2')], null);
    },
    properties: async () => [
      { id: 'p1', name: 'Pine Hill Phan Thiết' },
      { id: 'p2', name: 'Pine Hill Đà Lạt' },
    ],
  });
  expect(cursors).toEqual([undefined, 'r2']);
  expect(roomText('r2', names)).toBe('phòng SUP01');
  expect(roomText(null, names)).toBe('—');
  expect(targetText({ targetRoomId: 'r3', targetPropertyId: 'p2' }, names)).toBe(
    'phòng B101 · Pine Hill Đà Lạt',
  );
  expect(targetText({ targetRoomId: 'r1', targetPropertyId: null }, names)).toBe('phòng STD01');
  expect(targetText({ targetRoomId: null, targetPropertyId: 'p1' }, names)).toBe(
    'Pine Hill Phan Thiết',
  );
  expect(targetText({ targetRoomId: null, targetPropertyId: null }, names)).toBe('—');
});

test('HB-270: a failed name read never blocks the screen and never prints a UUID', async () => {
  const names = await loadPlaceNames({
    rooms: async () => {
      throw new Error('offline');
    },
    properties: async () => {
      throw new Error('offline');
    },
  });
  expect(roomText('c033b9a8-36d6-4011-b467-a2abfd6ec5a9', names)).toBe('phòng chưa rõ tên');
  expect(targetText({ targetRoomId: null, targetPropertyId: 'p9' }, names)).toBe(
    'cơ sở chưa rõ tên',
  );
});

test('HB-270: move types, statuses and actions read in Vietnamese', () => {
  expect(moveTypeText('UPGRADE_SAME_PROPERTY')).toBe('Nâng hạng cùng cơ sở');
  expect(moveTypeText('WALK_OUT')).toBe('Chuyển khách sang khách sạn khác');
  expect(moveStatusText('EXECUTED')).toBe('đã thực hiện');
  expect(moveStatusText('PROPOSED')).toBe('chờ duyệt');
  expect(actionText(['APPROVE', 'EXECUTE'])).toBe('duyệt, thực hiện');
  expect(actionText([])).toBe('không có');
});
