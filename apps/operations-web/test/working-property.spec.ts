import { describe, expect, it } from 'vitest';
import { chooseProperty } from '../src/lib/working-property';

/** HB-314 (TD-44) — chọn cơ sở mở màn: lựa chọn trên màn > cơ sở đang làm việc > cơ sở đầu danh sách. */
describe('chooseProperty', () => {
  const available = [{ id: 'p-dl' }, { id: 'p-vt' }];

  it('giữ cơ sở người dùng vừa chọn nếu có trong danh sách', () => {
    expect(chooseProperty(available, 'p-vt', 'p-dl')).toBe('p-vt');
  });

  it('không có lựa chọn thì mở ở cơ sở đang làm việc', () => {
    expect(chooseProperty(available, '', 'p-vt')).toBe('p-vt');
  });

  it('cơ sở ngoài danh sách máy chủ trả bị bỏ qua, về cơ sở đầu', () => {
    expect(chooseProperty(available, 'p-khac', 'p-ngoai')).toBe('p-dl');
    expect(chooseProperty(available, '', undefined)).toBe('p-dl');
  });

  it('danh sách rỗng thì rỗng', () => {
    expect(chooseProperty([], 'p-dl', 'p-dl')).toBe('');
  });
});
