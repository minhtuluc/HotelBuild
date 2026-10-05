import type { CheckInInput, DebtApproval } from '../../src/front-office/index.js';

export const approval: DebtApproval = {
  bookingId: 'booking-1',
  amount: 200_000,
  approverRole: 'MANAGER',
};
export const input: CheckInInput = {
  bookingId: 'booking-1',
  status: 'CONFIRMED',
  checkInDate: '2026-10-05',
  localNow: {
    date: '2026-10-05',
    millisecondsSinceMidnight: 54_000_000,
    timeZone: 'Asia/Ho_Chi_Minh',
  },
  totalAmount: 2_000_000,
  balanceDue: 0,
  firstNightAmount: 1_100_000,
  units: [
    {
      roomId: 'room-1',
      bedNo: 0,
      status: 'ACTIVE',
      blockedAtHandover: false,
      occupiedAtHandover: false,
      readinessForCurrentRelease: 'DONE',
    },
  ],
  debtApproval: null,
};

export function debt(balanceDue: number, totalAmount: number, approverRole: string): CheckInInput {
  return {
    ...input,
    balanceDue,
    totalAmount,
    debtApproval: { ...approval, amount: balanceDue, approverRole },
  };
}
