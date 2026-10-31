import { describe, expect, it } from 'vitest';
import {
  canCloseReconciliation,
  canConfirmEarlyCheckout,
  cashIssue,
  defaultBusinessDate,
  earlyCheckoutPreviewRequestOf,
  hasDiscrepancyWarning,
  reconciliationRequestOf,
} from '../../src/app/(ops)/reconciliation/model';

describe('HB-111 SCR-39 & SCR-69 pure model', () => {
  it('formats business date in Asia/Ho_Chi_Minh timezone', () => {
    expect(defaultBusinessDate(new Date('2026-12-24T18:00:00.000Z'))).toBe('2026-12-25');
  });

  it('validates non-negative VND integer counted cash', () => {
    expect(cashIssue('0')).toBeNull();
    expect(cashIssue(' 1250000 ')).toBeNull();
    expect(cashIssue('-1')).toBe('FORMAT');
    expect(cashIssue('12.5')).toBe('FORMAT');
    expect(cashIssue('')).toBe('FORMAT');
  });

  it('gates reconciliation close on verified PIN, valid cash, propertyId, and businessDate', () => {
    expect(canCloseReconciliation('verified', null, 'p1', '2026-12-24')).toBe(true);
    expect(canCloseReconciliation('idle', null, 'p1', '2026-12-24')).toBe(false);
    expect(canCloseReconciliation('verified', 'FORMAT', 'p1', '2026-12-24')).toBe(false);
    expect(canCloseReconciliation('verified', null, '', '2026-12-24')).toBe(false);
  });

  it('builds reconciliation close payload and detects > 50,000 VND discrepancy', () => {
    expect(
      reconciliationRequestOf({
        propertyId: 'p1',
        businessDate: '2026-12-24',
        countedCash: '900000',
        note: '  Lệch nhẹ  ',
      }),
    ).toEqual({
      propertyId: 'p1',
      businessDate: '2026-12-24',
      countedCash: 900_000,
      note: 'Lệch nhẹ',
    });
    expect(hasDiscrepancyWarning({ difference: -50_000, managerNotified: false })).toBe(false);
    expect(hasDiscrepancyWarning({ difference: -50_001, managerNotified: true })).toBe(true);
  });

  it('builds early checkout preview request and requires both preview and verified PIN', () => {
    expect(earlyCheckoutPreviewRequestOf('b1', '  Khách về sớm  ')).toEqual({
      bookingId: 'b1',
      lateCheckOut: false,
      earlyCheckOut: true,
      note: 'Khách về sớm',
    });
    expect(canConfirmEarlyCheckout('verified', null)).toBe(false);
    expect(
      canConfirmEarlyCheckout('verified', {
        bookingId: 'b1',
        feeAmount: 300_000,
        extrasAmount: 0,
        balanceDue: 300_000,
        computedAt: '2026-12-24T04:00:00.000Z',
      }),
    ).toBe(true);
  });
});
