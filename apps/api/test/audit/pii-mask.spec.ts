/** HB-009 AC3: che PII theo cấu hình một chỗ (NFR-SEC-03) — unit test ngoài bộ test khoá. */
import { describe, expect, it } from 'vitest';
import { maskSnapshot } from '../../src/infrastructure/audit/audit-writer.js';

describe('maskSnapshot', () => {
  it('che trường nhạy cảm ở mọi độ sâu, giữ 4 ký tự cuối và không sửa đầu vào', () => {
    const input = {
      value: 'old',
      password_hash: 'synthetic-secret',
      phone: '+84912345678',
      guests: [
        { phone: '0901234567', email: 'synthetic@example.invalid', idNumber: '123456789012' },
      ],
      nested: { passwordHash: 'nested-secret', id_number: '987654321012' },
      metadata: null,
      count: 3,
      active: true,
    };
    const original = structuredClone(input);

    const masked = maskSnapshot(input);

    expect(masked).toEqual({
      value: 'old',
      password_hash: '****cret',
      phone: '****5678',
      guests: [{ phone: '****4567', email: '****alid', idNumber: '****9012' }],
      nested: { passwordHash: '****cret', id_number: '****1012' },
      metadata: null,
      count: 3,
      active: true,
    });
    expect(input).toEqual(original);
  });

  it('chuỗi ngắn bị che toàn bộ, giá trị không phải chuỗi giữ nguyên', () => {
    expect(maskSnapshot({ phone: '123', email: '', note: 'giữ nguyên' })).toEqual({
      phone: '****',
      email: '****',
      note: 'giữ nguyên',
    });
    expect(maskSnapshot({ phone: null, email: 42 })).toEqual({ phone: null, email: 42 });
  });

  it('snapshot null giữ null (sự kiện hệ thống)', () => {
    expect(maskSnapshot(null)).toBeNull();
  });

  it('không tự thêm/bớt khoá của mảng và đối tượng', () => {
    const masked = maskSnapshot([{ phone: '0901234567' }, { email: 'a@b.co' }]);
    expect(masked).toEqual([{ phone: '****4567' }, { email: '****b.co' }]);
  });
});
