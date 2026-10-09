/** HB-080: phần thuần SCR-01 — mặc định kỳ, kiểm tại chỗ và truy vấn tìm phòng. */
import { describe, expect, it } from 'vitest';
import {
  MAX_ADULTS,
  MAX_CHILDREN,
  addDays,
  businessDate,
  defaultDraft,
  searchHref,
  searchQuery,
  validateSearch,
} from '../../src/app/(guest)/search/search-model';

const NOW = new Date('2026-10-08T02:00:00Z'); // 09:00 giờ VN

describe('businessDate / addDays (AC1)', () => {
  it('lấy ngày nghiệp vụ theo giờ VN và cộng ngày qua mốc tháng', () => {
    expect(businessDate(NOW)).toBe('2026-10-08');
    expect(businessDate(new Date('2026-10-07T18:00:00Z'))).toBe('2026-10-08');
    expect(businessDate(new Date('2026-10-07T16:59:00Z'))).toBe('2026-10-07');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('defaultDraft (AC1)', () => {
  it('mặc định một đêm kể từ hôm nay, 2 người lớn, 0 trẻ em, chưa chọn cơ sở', () => {
    expect(defaultDraft(NOW)).toEqual({
      propertyId: '',
      checkIn: '2026-10-08',
      checkOut: '2026-10-09',
      adults: '2',
      children: '0',
    });
  });
});

describe('validateSearch (AC1)', () => {
  const valid = defaultDraft(NOW);

  it('bản hợp lệ không có lỗi', () => {
    expect(validateSearch({ ...valid, propertyId: 'p1' })).toEqual([]);
  });

  it('bắt buộc cơ sở, ngày và chặn kỳ không có đêm nào', () => {
    expect(validateSearch(valid)).toContainEqual({ field: 'propertyId', issue: 'REQUIRED' });
    expect(validateSearch({ ...valid, propertyId: 'p1', checkIn: '' })).toContainEqual({
      field: 'checkIn',
      issue: 'REQUIRED',
    });
    expect(validateSearch({ ...valid, propertyId: 'p1', checkOut: '2026-10-08' })).toContainEqual({
      field: 'checkOut',
      issue: 'BEFORE_START',
    });
    expect(validateSearch({ ...valid, propertyId: 'p1', checkOut: '2026-10-07' })).toContainEqual({
      field: 'checkOut',
      issue: 'BEFORE_START',
    });
  });

  it('chặn số khách ngoài khoảng và giá trị không phải số nguyên', () => {
    expect(validateSearch({ ...valid, propertyId: 'p1', adults: '0' })).toContainEqual({
      field: 'adults',
      issue: 'OUT_OF_RANGE',
    });
    expect(
      validateSearch({ ...valid, propertyId: 'p1', adults: String(MAX_ADULTS + 1) }),
    ).toContainEqual({ field: 'adults', issue: 'OUT_OF_RANGE' });
    expect(validateSearch({ ...valid, propertyId: 'p1', adults: '2.5' })).toContainEqual({
      field: 'adults',
      issue: 'OUT_OF_RANGE',
    });
    expect(
      validateSearch({ ...valid, propertyId: 'p1', children: String(MAX_CHILDREN + 1) }),
    ).toContainEqual({ field: 'children', issue: 'OUT_OF_RANGE' });
    expect(validateSearch({ ...valid, propertyId: 'p1', children: '-1' })).toContainEqual({
      field: 'children',
      issue: 'OUT_OF_RANGE',
    });
  });
});

describe('searchHref (AC1)', () => {
  it('dựng truy vấn tìm phòng chỉ với trường hợp đồng khai', () => {
    const draft = { ...defaultDraft(NOW), propertyId: 'synthetic-property', adults: '03' };
    expect([...searchQuery(draft).keys()].sort()).toEqual([
      'adults',
      'checkIn',
      'checkOut',
      'children',
      'propertyId',
    ]);
    expect(searchQuery(draft).get('adults')).toBe('3');
    expect(searchHref(draft)).toBe(
      '/search?propertyId=synthetic-property&checkIn=2026-10-08&checkOut=2026-10-09&adults=3&children=0',
    );
  });
});
