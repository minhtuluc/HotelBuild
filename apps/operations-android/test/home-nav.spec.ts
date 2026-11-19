import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('react-native', () => ({}));
import { catalog } from '../src/strings';

// HB-261: SCR-67 (cảnh báo quá tải) và SCR-63 (đổi phòng) đã có route `(f6)/alerts`, `(f6)/relocation`
// nhưng màn chính không có đường vào — chỉ mở được bằng deep link, nên lễ tân/quản lý không dùng được.
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('màn chính có thẻ mở cảnh báo quá tải, câu chữ lấy từ catalog', () => {
  const home = source('../app/home.tsx');
  expect(home).toContain("testID: 'open-alerts'");
  expect(home).toContain("t('home.alerts')");
  expect(catalog['home.alerts'].length).toBeGreaterThan(0);
});

test('luồng chính đẩy route `/alerts` (Back của Stack quay lại màn chính)', () => {
  expect(source('../app/index.tsx')).toContain("onAlerts={() => router.push('/alerts')}");
});
