/** HB-081: phần thuần SCR-02 — đọc kỳ từ truy vấn và dựng liên kết sang SCR-03. */
import { describe, expect, it } from 'vitest';
import {
  criteriaIssue,
  criteriaQuery,
  detailHref,
  parseCriteria,
} from '../../src/app/(guest)/search/search-params';

const VALID =
  'propertyId=synthetic-property&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0&roomCount=1';

describe('parseCriteria (AC1)', () => {
  it('đọc đủ trường và áp mặc định cho trẻ em/số phòng khi thiếu', () => {
    expect(parseCriteria(new URLSearchParams(VALID))).toEqual({
      propertyId: 'synthetic-property',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      adults: 2,
      children: 0,
      roomCount: 1,
    });
    expect(
      parseCriteria(
        new URLSearchParams('propertyId=p&checkIn=2026-12-24&checkOut=2026-12-25&adults=3'),
      ),
    ).toEqual({
      propertyId: 'p',
      checkIn: '2026-12-24',
      checkOut: '2026-12-25',
      adults: 3,
      children: 0,
      roomCount: 1,
    });
  });

  it('trả null khi thiếu/sai tham số bắt buộc', () => {
    expect(parseCriteria(new URLSearchParams(''))).toBeNull();
    expect(parseCriteria(new URLSearchParams(VALID.replace('adults=2', 'adults=0')))).toBeNull();
    expect(parseCriteria(new URLSearchParams(VALID.replace('adults=2', 'adults=2.5')))).toBeNull();
    expect(
      parseCriteria(
        new URLSearchParams(VALID.replace('checkOut=2026-12-26', 'checkOut=2026-12-24')),
      ),
    ).toBeNull();
    expect(
      parseCriteria(new URLSearchParams(VALID.replace('checkIn=2026-12-24', 'checkIn=24-12-2026'))),
    ).toBeNull();
  });

  it('nói rõ trường nào còn thiếu để màn hình hướng dẫn', () => {
    expect(criteriaIssue(new URLSearchParams(''))).toEqual({
      field: 'propertyId',
      issue: 'REQUIRED',
    });
    expect(
      criteriaIssue(
        new URLSearchParams(VALID.replace('checkOut=2026-12-26', 'checkOut=2026-12-01')),
      ),
    ).toEqual({ field: 'checkOut', issue: 'BEFORE_START' });
  });
});

describe('criteriaQuery / detailHref (AC1)', () => {
  it('giữ nguyên kỳ khi mở chi tiết loại phòng', () => {
    const criteria = {
      propertyId: 'p1',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      adults: 2,
      children: 1,
      roomCount: 1,
    };
    expect([...criteriaQuery(criteria).keys()].sort()).toEqual([
      'adults',
      'checkIn',
      'checkOut',
      'children',
      'propertyId',
      'roomCount',
    ]);
    expect(detailHref(criteria, 'rt 1')).toBe(
      '/rooms/rt%201?propertyId=p1&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=1&roomCount=1',
    );
  });
});
