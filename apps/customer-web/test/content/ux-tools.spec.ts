import { describe, expect, it } from 'vitest';
import { nextIndex } from '../../src/components/content/cabin-diagram';
import { classCompareRows } from '../../src/components/content/class-compare';
import { activeTocId } from '../../src/components/content/page-toc';
import { frontDeskLine } from '../../src/components/front-desk-line';
import { LOCALES } from '../../src/i18n/locales';
import { translatorsFor } from '../../src/i18n/translate';

/** HB-323 — so sánh hạng (FEAT-05), mặt cắt khoang (UX-02), mục lục (UX-06), liên hệ lễ tân (P6). */

describe('bảng so sánh năm hạng', () => {
  it('đúng sức chứa, số chỗ ngủ (BR-PROP-04) và cách bán; Dorm bán theo giường', () => {
    const rows = classCompareRows('vi');
    expect(rows.map((row) => row.code)).toEqual(['STD', 'SUP', 'DLX', 'FAM', 'DOR']);
    expect(Object.fromEntries(rows.map((row) => [row.code, row.sleeps]))).toEqual({
      STD: 2,
      SUP: 2,
      DLX: 3,
      FAM: 4,
      DOR: 6,
    });
    expect(rows.filter((row) => row.soldBy === 'bed').map((row) => row.code)).toEqual(['DOR']);
  });

  it('mọi locale đủ năm hàng, mỗi hàng có tên, khoang, sức chứa và "hợp với"', () => {
    for (const locale of LOCALES) {
      const rows = classCompareRows(locale);
      expect(rows, locale).toHaveLength(5);
      for (const row of rows) {
        expect(
          [row.name, row.cabin, row.capacity, row.suits].every((text) => text.trim() !== ''),
          `${locale}.${row.code}`,
        ).toBe(true);
      }
    }
  });
});

describe('liên hệ lễ tân khi lỗi mạng (P6)', () => {
  it('có cấu hình thì in số lễ tân; chưa có thì hướng dẫn chung, không bịa số', () => {
    const { t } = translatorsFor('vi');
    expect(frontDeskLine(t, 'Lễ tân: 0263 000 000')).toContain('Lễ tân: 0263 000 000');
    const generic = frontDeskLine(t, null);
    expect(generic).toContain('lễ tân');
    expect(generic).not.toMatch(/\d{3}/);
    expect(generic).not.toContain('mailto');
  });
});

describe('mặt cắt khoang và mục lục', () => {
  it('phím mũi tên vòng quanh năm khoang; Home/End về đầu, cuối; phím khác không đổi', () => {
    expect(nextIndex('ArrowRight', 4, 5)).toBe(0);
    expect(nextIndex('ArrowLeft', 0, 5)).toBe(4);
    expect(nextIndex('ArrowDown', 1, 5)).toBe(2);
    expect(nextIndex('Home', 3, 5)).toBe(0);
    expect(nextIndex('End', 0, 5)).toBe(4);
    expect(nextIndex('Enter', 2, 5)).toBeNull();
  });

  it('mục đang đọc là mục cuối đã qua vạch đọc; chưa tới mục nào thì null', () => {
    const tops = [
      { id: 'a', top: -400 },
      { id: 'b', top: 120 },
      { id: 'c', top: 900 },
    ];
    expect(activeTocId(tops, 250)).toBe('b');
    expect(activeTocId(tops, 100)).toBe('a');
    expect(activeTocId([{ id: 'a', top: 500 }], 250)).toBeNull();
  });
});
