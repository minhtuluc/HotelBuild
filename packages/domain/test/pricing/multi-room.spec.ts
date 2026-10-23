import { describe, expect, it } from 'vitest';
import * as pricing from '../../src/pricing/index.js';
import { input, promo } from './fixtures.js';
import type { PricingInput } from '../../src/pricing/index.js';

/** HB-205 / QĐ-06 mục 1: booking `roomCount = N` tính N đơn vị bán, khuyến mãi áp một lần trên tổng. */
function quote(i: PricingInput) {
  const result = pricing.quotePrice(i);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const withUnits = (i: PricingInput, units: number): PricingInput => ({ ...i, units });
const floor1000 = (n: number) => Math.floor(n / 1000) * 1000;
const ceil1000 = (n: number) => Math.ceil(n / 1000) * 1000;

describe('HB-205 giá nhiều phòng', () => {
  const stay = () => input('DLX', '2026-11-17', '2026-11-19');

  it('units=1 và không khai units cho đúng cùng một kết quả (hồi quy từng con số)', () => {
    expect(quote(withUnits(stay(), 1))).toEqual(quote(stay()));
  });

  it('nightlyPrice giữ giá MỘT đơn vị; subtotal/total/cọc là tổng N đơn vị', () => {
    const one = quote(stay());
    for (const units of [2, 3, 10]) {
      const many = quote(withUnits(stay(), units));
      expect(many.nights.map((n) => n.nightlyPrice)).toEqual(one.nights.map((n) => n.nightlyPrice));
      expect(many.subtotal).toBe(one.subtotal * units);
      expect(many.total).toBe(one.total * units);
      expect(many.depositAmount).toBe(ceil1000(many.total * 0.3));
    }
  });

  it('khuyến mãi AMOUNT chỉ trừ MỘT lần trên tổng N phòng (BR-RATE-10/13)', () => {
    const one = quote({ ...stay(), promotions: [promo('A100', 'AMOUNT', '100000')] });
    const two = quote(withUnits({ ...stay(), promotions: [promo('A100', 'AMOUNT', '100000')] }, 2));
    expect(one.discountAmount).toEqual({ numerator: '100000', denominator: '1' });
    expect(two.discountAmount).toEqual({ numerator: '100000', denominator: '1' });
    const base = quote(withUnits(stay(), 2));
    expect(two.total).toBe(floor1000(base.subtotal - 100000));
  });

  it('khuyến mãi PERCENT tính trên tổng N phòng', () => {
    const base = quote(withUnits(stay(), 3));
    const out = quote(withUnits({ ...stay(), promotions: [promo('P10', 'PERCENT', '10')] }, 3));
    expect(out.total).toBe(floor1000(base.subtotal * 0.9));
  });

  it('trần giảm 30% tính trên tổng N phòng (BR-RATE-11)', () => {
    // WALKIN (×1,10) để 70% tổng vẫn ≥ sàn: trần 30% là ràng buộc chạm trước, không phải sàn.
    const walkIn = () => input('DLX', '2026-11-17', '2026-11-19', 'WALKIN');
    const base = quote(withUnits(walkIn(), 2));
    const out = quote(
      withUnits({ ...walkIn(), promotions: [promo('A9M', 'AMOUNT', '9000000')] }, 2),
    );
    expect(out.warnings).toContain('E_RATE_DISCOUNT_CAPPED');
    expect(out.total).toBe(floor1000(base.subtotal * 0.7));
  });

  it('sàn BR-RATE-12 = N × tổng sàn các đêm: mã vượt sàn một phòng nhưng hợp lệ trên tổng hai phòng', () => {
    const nightly = quote(stay()).nights[0]!.nightlyPrice;
    const min = stay().room.minPrice;
    const amount = String(nightly - min + 1000);
    const promotions = [promo('FLOOR', 'AMOUNT', amount)];
    const one = quote({
      ...stay(),
      promotions: [promo('FLOOR', 'AMOUNT', String((nightly - min) * 2 + 1000))],
    });
    expect(one.warnings).toContain('E_RATE_BELOW_FLOOR');
    expect(one.appliedPromotions).toEqual([]);
    const two = quote(withUnits({ ...stay(), promotions }, 2));
    expect(two.warnings).not.toContain('E_RATE_BELOW_FLOOR');
    expect(two.appliedPromotions).toEqual(['FLOOR']);
  });

  it('LOS tính theo số đêm, không theo số phòng', () => {
    const long = input('DLX', '2026-11-17', '2026-11-24');
    const one = quote(long);
    const three = quote(withUnits(long, 3));
    expect(three.nights.map((n) => n.losMultiplier)).toEqual(
      one.nights.map((n) => n.losMultiplier),
    );
    expect(three.total).toBe(one.total * 3);
  });

  it('ENGINE_VERSION tăng lên 1.1.0', () => {
    expect(pricing.ENGINE_VERSION).toBe('pricing-1.1.0');
    expect(quote(stay()).engineVersion).toBe('pricing-1.1.0');
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53])('units không hợp lệ %s bị từ chối', (units) => {
    const result = pricing.quotePrice(withUnits(stay(), units));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('E_RATE_INVALID_INPUT');
  });
});
