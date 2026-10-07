/** HB-059: phần thuần SCR-27 — kiểm bản nhập, thân lệnh tạo mùa, mùa thắng/chồng lấn từ máy chủ. */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SEASON_DRAFT,
  calendarRows,
  overlappingSeasonNames,
  parseMultiplier,
  parsePriority,
  toCreateRequest,
  validateSeasonDraft,
  type RateCalendarEntry,
  type SeasonDraft,
} from '../src/lib/seasons';

const draft = (over: Partial<SeasonDraft> = {}): SeasonDraft => ({
  ...EMPTY_SEASON_DRAFT,
  propertyId: 'p1',
  roomTypeId: 'rt1',
  name: 'Cao điểm hè',
  startDate: '2026-06-01',
  endDate: '2026-08-31',
  ...over,
});

const entry = (over: Partial<RateCalendarEntry> = {}): RateCalendarEntry => ({
  date: '2026-06-01',
  basePrice: 650_000,
  seasonMultiplier: 1.4,
  weekendMultiplier: 1,
  occupancyMultiplier: 1,
  losMultiplier: 1,
  channelMultiplier: 1,
  clamped: false,
  nightlyPrice: 910_000,
  ...over,
});

describe('parseMultiplier / parsePriority', () => {
  it('nhận dấu phẩy thập phân kiểu Việt Nam', () => {
    expect(parseMultiplier('1,25')).toBe(1.25);
    expect(parseMultiplier('1.25')).toBe(1.25);
    expect(parseMultiplier('abc')).toBeNull();
  });

  it('ưu tiên chỉ nhận số nguyên không âm', () => {
    expect(parsePriority('3')).toBe(3);
    expect(parsePriority('-1')).toBeNull();
    expect(parsePriority('1.5')).toBeNull();
  });
});

describe('validateSeasonDraft', () => {
  it('chặn thiếu trường bắt buộc', () => {
    const issues = validateSeasonDraft({ ...EMPTY_SEASON_DRAFT, multiplier: '1', priority: '0' });
    expect(issues.map((issue) => issue.field)).toEqual([
      'propertyId',
      'roomTypeId',
      'name',
      'startDate',
      'endDate',
    ]);
  });

  it('chặn khoảng ngày ngược và hệ số ngoài 0,1–5', () => {
    expect(validateSeasonDraft(draft({ startDate: '2026-08-31', endDate: '2026-06-01' }))).toEqual([
      { field: 'endDate', issue: 'BEFORE_START' },
    ]);
    expect(validateSeasonDraft(draft({ multiplier: '6' }))).toEqual([
      { field: 'multiplier', issue: 'OUT_OF_RANGE' },
    ]);
    expect(validateSeasonDraft(draft({ multiplier: '0' }))).toEqual([
      { field: 'multiplier', issue: 'OUT_OF_RANGE' },
    ]);
  });

  it('chặn ưu tiên không phải số nguyên', () => {
    expect(validateSeasonDraft(draft({ priority: 'x' }))).toEqual([
      { field: 'priority', issue: 'NOT_INTEGER' },
    ]);
  });

  it('bản nhập hợp lệ không có lỗi', () => {
    expect(validateSeasonDraft(draft())).toEqual([]);
  });
});

describe('toCreateRequest', () => {
  it('đổi hệ số/ưu tiên sang số và cắt tên', () => {
    expect(
      toCreateRequest(draft({ name: '  Lễ 30/4  ', multiplier: '1,5', priority: '7' })),
    ).toEqual({
      propertyId: 'p1',
      name: 'Lễ 30/4',
      startDate: '2026-06-01',
      endDate: '2026-08-31',
      multiplier: 1.5,
      priority: 7,
      weekendSurchargeEnabled: false,
    });
  });

  it('ném lỗi khi bản nhập chưa qua kiểm tra', () => {
    expect(() => toCreateRequest(draft({ priority: 'x' }))).toThrow(RangeError);
  });
});

describe('calendarRows / overlappingSeasonNames', () => {
  it('lấy nguyên mùa thắng máy chủ trả, không tự chọn', () => {
    const rows = calendarRows([
      entry({ date: '2026-06-01', source: 'SEASON', seasonName: 'Hè' }),
      entry({ date: '2026-06-02', source: 'BASE' }),
    ]);
    expect(rows[0]?.seasonName).toBe('Hè');
    expect(rows[1]?.seasonName).toBeNull();
  });

  it('nêu tên mùa chồng lấn, trừ chính tên đang tạo, không trùng', () => {
    const entries = [
      entry({ source: 'SEASON', seasonName: 'Hè' }),
      entry({ source: 'SEASON', seasonName: 'Hè' }),
      entry({ source: 'SEASON', seasonName: 'Lễ' }),
      entry({ source: 'OVERRIDE', seasonName: 'Hè' }),
      entry({ source: 'SEASON', seasonName: 'Cao điểm hè' }),
    ];
    expect(overlappingSeasonNames(entries, 'Cao điểm hè')).toEqual(['Hè', 'Lễ']);
    // Tên đang tạo để trống thì không loại trừ mùa nào.
    expect(overlappingSeasonNames(entries, '')).toEqual(['Hè', 'Lễ', 'Cao điểm hè']);
  });
});
