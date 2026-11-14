import { describe, expect, it } from 'vitest';
import type { PromotionSummary } from '@pinehill/contracts';
import {
  fromVnLocal,
  promotionEditDraftOf,
  toPromotionToggle,
  toPromotionUpdate,
  toVnLocal,
  validatePromotionEdit,
} from '../src/lib/promotions';

const promotion: PromotionSummary = {
  id: 'pr1',
  code: 'TET2027',
  type: 'PERCENT',
  value: 10,
  minNights: 2,
  channelScope: ['WEB', 'PHONE'],
  roomTypeScope: ['rt1'],
  validFrom: '2027-01-20T17:00:00.000Z',
  validTo: '2027-02-10T16:59:00.000Z',
  maxUses: 50,
  usedCount: 12,
  stackable: false,
  status: 'ACTIVE',
  version: 4,
};

describe('HB-311 sửa / tắt khuyến mãi', () => {
  it('giờ hiệu lực hiển thị và gửi theo giờ VN, không phụ thuộc múi giờ máy', () => {
    expect(toVnLocal('2027-01-20T17:00:00.000Z')).toBe('2027-01-21T00:00');
    expect(fromVnLocal('2027-01-21T00:00')).toBe('2027-01-20T17:00:00.000Z');
    expect(promotionEditDraftOf(promotion)).toMatchObject({
      validFrom: '2027-01-21T00:00',
      validTo: '2027-02-10T23:59',
      maxUses: '50',
    });
  });

  it('chỉ gửi trường đổi; đổi thứ tự kênh không tính là đổi; bỏ trống lượt tối đa là bỏ giới hạn', () => {
    const draft = { ...promotionEditDraftOf(promotion), reason: 'Gia hạn' };
    expect(toPromotionUpdate(promotion, draft)).toBeNull();
    expect(toPromotionUpdate(promotion, { ...draft, channelScope: ['PHONE', 'WEB'] })).toBeNull();
    expect(
      toPromotionUpdate(promotion, { ...draft, maxUses: '', validTo: '2027-02-15T23:59' }),
    ).toEqual({ maxUses: null, validTo: '2027-02-15T16:59:00.000Z', reason: 'Gia hạn' });
  });

  it('không cho hạ lượt tối đa dưới số lượt đã dùng và bắt buộc lý do', () => {
    const draft = { ...promotionEditDraftOf(promotion), maxUses: '5' };
    expect(validatePromotionEdit(promotion, draft)).toEqual([
      { field: 'maxUses', issue: 'BELOW_USED' },
      { field: 'reason', issue: 'REQUIRED' },
    ]);
  });

  it('tắt mã đang chạy, bật lại mã đã tắt', () => {
    expect(toPromotionToggle(promotion, 'Hết ngân sách')).toEqual({
      status: 'INACTIVE',
      reason: 'Hết ngân sách',
    });
    expect(toPromotionToggle({ ...promotion, status: 'INACTIVE' }, 'Mở lại').status).toBe('ACTIVE');
  });
});
