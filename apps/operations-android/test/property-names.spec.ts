import { describe, expect, it } from 'vitest';
import { loadPropertyNames, propertyLabel } from '../src/property-names';

// HB-264: màn "Chọn cơ sở" hiện UUID (`/auth/me` chỉ trả id trong `propertyScope`) — máy thật.
describe('tên cơ sở cho màn chọn cơ sở (HB-264)', () => {
  it('ghép tên theo id; chưa có tên thì vẫn hiện id để không chặn đăng nhập', () => {
    const names = new Map([['p-dl', 'Pine Hill Đà Lạt']]);
    expect(propertyLabel('p-dl', names)).toBe('Pine Hill Đà Lạt');
    expect(propertyLabel('p-xx', names)).toBe('p-xx');
  });

  it('tải tên từ danh sách công khai; lỗi mạng trả bảng rỗng thay vì ném', async () => {
    const ok = await loadPropertyNames(async () => [
      { id: 'p-dl', name: 'Pine Hill Đà Lạt' },
      { id: 'p-vt', name: 'Pine Hill Vũng Tàu' },
    ]);
    expect(ok.get('p-vt')).toBe('Pine Hill Vũng Tàu');
    const failed = await loadPropertyNames(async () => {
      throw new Error('offline');
    });
    expect(failed.size).toBe(0);
  });
});
