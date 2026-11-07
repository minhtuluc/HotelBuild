/**
 * HB-131 — `mappingInput` không được để khoá của JSON người dùng đổi prototype của đối tượng trung gian
 * (CodeQL `js/remote-property-injection`). Một khoá `__proto__` phải bị schema strict từ chối (400) như mọi
 * trường lạ khác, thay vì bị nuốt vào prototype rồi lọt qua.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { mappingInput } from '../../src/modules/chan/mappings/validation.js';

const base = () => ({ roomTypeId: randomUUID(), providerRoomTypeCode: 'STD-OTA' });

test('khoá __proto__ trong thân PUT mapping bị từ chối như trường lạ', () => {
  const hostile: unknown = JSON.parse(
    `{"roomTypeId":"${randomUUID()}","providerRoomTypeCode":"STD-OTA","__proto__":{"allotmentPct":55}}`,
  );
  expect(() => mappingInput(hostile)).toThrow();
});

test('thân hợp lệ: vắng allotmentPct ⇒ 80%, có thì giữ nguyên; trường lạ vẫn bị từ chối', () => {
  expect(mappingInput(base()).allotmentPct).toBe(80);
  expect(mappingInput({ ...base(), allotmentPct: 35 }).allotmentPct).toBe(35);
  expect(() => mappingInput({ ...base(), surprise: 1 })).toThrow();
  expect(() => mappingInput({ ...base(), allotmentPct: 0 })).toThrow();
});
