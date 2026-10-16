import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { t } from '../../src/lib/i18n';
import { formatHoursBeforeCheckIn } from '../../src/app/(guest)/bookings/cancel-model';

/**
 * HB-103 (dư âu HB-186): số giờ huỷ hiển thị theo quy ước `vi-VN` (dấu phẩy thập phân, NFR-LOC-02)
 * và các nhãn màn trạng thái F0 lấy từ danh mục chuỗi thay vì viết cứng.
 */

it('số giờ huỷ dùng dấu phẩy thập phân vi-VN, không dùng dấu chấm', () => {
  for (const [input, expected] of [
    [48, '48,0'],
    [96, '96,0'],
    [5.5, '5,5'],
    [0, '0,0'],
  ] as const) {
    const displayed = formatHoursBeforeCheckIn(input);
    expect(displayed).toBe(expected);
    expect(displayed).not.toContain('.');
  }
});

it('nhãn màn F0 lấy từ danh mục và giữ nguyên câu chữ cũ', () => {
  expect(t('guest.states.adults')).toBe('Số người lớn');
  expect(t('guest.states.continue')).toBe('Tiếp tục');
});

it('metadata mô tả ứng dụng lấy từ danh mục, giữ nguyên câu chữ', () => {
  expect(t('guest.app.description')).toBe('Đặt phòng trực tiếp tại chuỗi Pine Hill');
});

it('states-client dùng khoá danh mục, không còn nhãn viết cứng', () => {
  const source = readFileSync(
    new URL('../../src/app/(guest)/states/states-client.tsx', import.meta.url),
    'utf8',
  );
  expect(source).toContain("t('guest.states.adults')");
  expect(source).toContain("t('guest.states.continue')");
  expect(source).not.toContain('Số người lớn');
  expect(source).not.toContain('Tiếp tục<');
});

it('metadata của layout lấy mô tả từ danh mục', () => {
  const source = readFileSync(new URL('../../src/app/layout.tsx', import.meta.url), 'utf8');
  expect(source).toContain("customerCatalog['guest.app.description']");
  expect(source).not.toContain('Đặt phòng trực tiếp tại chuỗi Pine Hill');
});
