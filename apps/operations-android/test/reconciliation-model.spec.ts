import { describe, expect, it } from 'vitest';
import type { ReconciliationCloseResponse } from '@pinehill/contracts';
import {
  businessDateVn,
  canClose,
  closeBodyFor,
  closeMatches,
  parseCountedCash,
} from '../src/reconciliation/model';

// HB-263 — SCR-68 đối soát nhanh theo ngày trên app vận hành.
describe('SCR-68 đối soát tiền mặt (HB-263)', () => {
  it('ngày nghiệp vụ theo giờ VN (UTC+7), không theo giờ máy', () => {
    expect(businessDateVn(Date.parse('2026-11-19T16:59:00Z'))).toBe('2026-11-19');
    expect(businessDateVn(Date.parse('2026-11-19T17:00:00Z'))).toBe('2026-11-20');
  });

  it('chỉ kế toán chốt quỹ (tách nhiệm vụ); lễ tân chỉ xem', () => {
    expect(canClose('ACCOUNTANT')).toBe(true);
    expect(canClose('FRONT_DESK')).toBe(false);
    expect(canClose('MANAGER')).toBe(false);
  });

  it('số tiền đếm: nhận dấu chấm/khoảng trắng phân cách nghìn; sai dạng hoặc âm thì từ chối', () => {
    expect(parseCountedCash('1.210.000')).toBe(1_210_000);
    expect(parseCountedCash(' 390 000 ')).toBe(390_000);
    expect(parseCountedCash('0')).toBe(0);
    expect(parseCountedCash('')).toBeNull();
    expect(parseCountedCash('12a')).toBeNull();
    expect(parseCountedCash('-5')).toBeNull();
  });

  it('thân lệnh chốt mang người thu được đối soát; ghi chú rỗng thì bỏ', () => {
    expect(closeBodyFor('p1', '2026-11-19', 'u-fd', 390_000, '  ')).toEqual({
      propertyId: 'p1',
      businessDate: '2026-11-19',
      collectorId: 'u-fd',
      countedCash: 390_000,
    });
    expect(closeBodyFor('p1', '2026-11-19', 'u-fd', 0, ' thiếu tiền lẻ ').note).toBe(
      'thiếu tiền lẻ',
    );
  });

  it('phản hồi phải đúng lệnh vừa gửi (cơ sở, ngày, số đếm)', () => {
    const body = closeBodyFor('p1', '2026-11-19', 'u-fd', 390_000, '');
    const response: ReconciliationCloseResponse = {
      propertyId: 'p1',
      businessDate: '2026-11-19',
      expectedCash: 390_000,
      countedCash: 390_000,
      difference: 0,
      managerNotified: false,
      auditLogId: 'a1',
      closedAt: '2026-11-19T10:00:00.000Z',
    };
    expect(closeMatches(body, response)).toBe(true);
    expect(closeMatches(body, { ...response, countedCash: 1 })).toBe(false);
  });
});
