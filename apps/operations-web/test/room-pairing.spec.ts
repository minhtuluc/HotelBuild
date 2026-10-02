import { describe, expect, it } from 'vitest';
import type { RoomSummary } from '@pinehill/contracts';
import {
  connectingCode,
  isSymmetrical,
  pairingCandidates,
  sortByFloorThenCode,
} from '../src/lib/room-pairing';

function room(overrides: Partial<RoomSummary> & Pick<RoomSummary, 'id' | 'code'>): RoomSummary {
  return {
    propertyId: 'p1',
    roomTypeId: 'rt1',
    floor: 1,
    status: 'ACTIVE',
    connectingRoomId: null,
    version: 1,
    ...overrides,
  };
}

const A = room({ id: 'r1', code: '101' });
const B = room({ id: 'r2', code: '102', floor: 2 });
const OTHER_PROPERTY = room({ id: 'r3', code: '201', propertyId: 'p2' });

describe('phòng thông nhau (BR-OVER-15)', () => {
  it('trả mã phòng đối ứng, null khi chưa thông hoặc không thấy phòng đối ứng', () => {
    expect(connectingCode([A, B], 'r1')).toBeNull();
    expect(connectingCode([{ ...A, connectingRoomId: 'r2' }, B], 'r1')).toBe('102');
    expect(connectingCode([{ ...A, connectingRoomId: 'r9' }, B], 'r1')).toBeNull();
  });

  it('chỉ nhận phòng cùng cơ sở và khác chính nó làm ứng viên', () => {
    expect(pairingCandidates([A, B, OTHER_PROPERTY], 'r1').map((item) => item.id)).toEqual(['r2']);
    expect(pairingCandidates([A, B], 'missing')).toEqual([]);
  });

  it('phát hiện liên kết một chiều', () => {
    const oneWay = [{ ...A, connectingRoomId: 'r2' }, B];
    expect(isSymmetrical(oneWay, 'r1')).toBe(false);
    const twoWay = [
      { ...A, connectingRoomId: 'r2' },
      { ...B, connectingRoomId: 'r1' },
    ];
    expect(isSymmetrical(twoWay, 'r1')).toBe(true);
    expect(isSymmetrical([A, B], 'r1')).toBe(true);
  });

  it('xếp buồng theo tầng rồi theo mã', () => {
    const floor2 = room({ id: 'r4', code: '103', floor: 2 });
    expect(sortByFloorThenCode([floor2, B, A]).map((item) => item.code)).toEqual([
      '101',
      '102',
      '103',
    ]);
  });
});
