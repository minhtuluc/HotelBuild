/** HB-039: phần thuần SCR-22 — chồng lấn, kiểm bản nhập, thân lệnh tạo khoá (BR-INV-06). */
import { describe, expect, it } from 'vitest';
import type { RoomBlock } from '@pinehill/contracts';
import {
  EMPTY_ROOM_BLOCK_DRAFT,
  conflictingBlocks,
  overlaps,
  toCreateRequest,
  validateDraft,
  type RoomBlockDraft,
} from '../src/lib/room-blocks';

const block = (over: Partial<RoomBlock> = {}): RoomBlock => ({
  id: 'b1',
  roomId: 'r1',
  startDate: '2026-12-20',
  endDate: '2026-12-22',
  reason: 'MAINTENANCE',
  note: null,
  ...over,
});

const draft = (over: Partial<RoomBlockDraft> = {}): RoomBlockDraft => ({
  ...EMPTY_ROOM_BLOCK_DRAFT,
  roomId: 'r1',
  startDate: '2026-12-25',
  endDate: '2026-12-27',
  ...over,
});

describe('overlaps', () => {
  it('half-open API ranges: adjacent and empty intervals never overlap', () => {
    expect(overlaps({ startDate: '2026-12-22', endDate: '2026-12-25' }, block())).toBe(false);
    expect(overlaps({ startDate: '2026-12-18', endDate: '2026-12-20' }, block())).toBe(false);
    expect(overlaps({ startDate: '2026-12-20', endDate: '2026-12-20' }, block())).toBe(false);
    expect(overlaps({ startDate: '2026-12-21', endDate: '2026-12-21' }, block())).toBe(false);
    expect(overlaps({ startDate: '2026-12-21', endDate: '2026-12-23' }, block())).toBe(true);
    expect(overlaps({ startDate: '2026-12-19', endDate: '2026-12-21' }, block())).toBe(true);
  });

  it('không chồng khi rời hẳn về hai phía', () => {
    expect(overlaps({ startDate: '2026-12-23', endDate: '2026-12-24' }, block())).toBe(false);
    expect(overlaps({ startDate: '2026-12-18', endDate: '2026-12-19' }, block())).toBe(false);
  });
});

describe('conflictingBlocks', () => {
  it('chỉ tính khoá cùng phòng và giao khoảng', () => {
    const blocks = [
      block({ id: 'b1', roomId: 'r1', startDate: '2026-12-20', endDate: '2026-12-26' }),
      block({ id: 'b2', roomId: 'r2', startDate: '2026-12-20', endDate: '2026-12-26' }),
      block({ id: 'b3', roomId: 'r1', startDate: '2026-12-30', endDate: '2026-12-31' }),
    ];
    const result = conflictingBlocks(draft(), blocks);
    expect(result.map((item) => item.id)).toEqual(['b1']);
  });

  it('thiếu phòng/ngày thì không kết luận chồng lấn', () => {
    expect(conflictingBlocks({ roomId: '', startDate: '', endDate: '' }, [block()])).toEqual([]);
  });
});

describe('validateDraft', () => {
  it('chặn thiếu trường và khoảng ngày ngược', () => {
    expect(validateDraft(EMPTY_ROOM_BLOCK_DRAFT)).toEqual([
      { field: 'roomId', issue: 'REQUIRED' },
      { field: 'startDate', issue: 'REQUIRED' },
      { field: 'endDate', issue: 'REQUIRED' },
    ]);
    expect(validateDraft(draft({ startDate: '2026-12-27', endDate: '2026-12-25' }))).toEqual([
      { field: 'endDate', issue: 'BEFORE_START' },
    ]);
  });

  it('equal-day request is rejected by the established API; one night ends the next day', () => {
    expect(validateDraft(draft({ startDate: '2026-12-25', endDate: '2026-12-25' }))).toEqual([
      { field: 'endDate', issue: 'BEFORE_START' },
    ]);
    expect(validateDraft(draft({ startDate: '2026-12-25', endDate: '2026-12-26' }))).toEqual([]);
  });

  it('impossible Gregorian dates do not create a request or overlap warning', () => {
    for (const value of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-12-32', '2026-1-01']) {
      expect(validateDraft(draft({ startDate: value, endDate: '2027-01-01' }))).toContainEqual({
        field: 'startDate',
        issue: 'INVALID',
      });
      expect(conflictingBlocks(draft({ startDate: value }), [block()])).toEqual([]);
    }
    expect(validateDraft(draft({ startDate: '2028-02-29', endDate: '2028-03-01' }))).toEqual([]);
  });
});

describe('toCreateRequest', () => {
  it('bỏ ghi chú trống, cắt khoảng trắng thừa', () => {
    expect(toCreateRequest(draft())).toEqual({
      roomId: 'r1',
      startDate: '2026-12-25',
      endDate: '2026-12-27',
      reason: 'MAINTENANCE',
    });
    expect(toCreateRequest(draft({ note: '  thay bóng đèn  ' })).note).toBe('thay bóng đèn');
  });
});
