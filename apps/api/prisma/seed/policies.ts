/**
 * Chính sách huỷ (4 chính sách + 11 bậc) và gói giá (4) — HB-018.
 * Nguồn: `02-nghiep-vu/chinh-sach-huy-hoan-coc.md` §2–§3; cọc Q-01; đổi ngày Q-12; LOS `dong-gia.md` §4.4.
 */
export interface CancellationTierSeed {
  offsetHours: number;
  refundPercent: number;
  chargeFirstNight: boolean;
  label: string;
  sortOrder: number;
}

export interface CancellationPolicySeed {
  code: string;
  name: string;
  isDefault: boolean;
  earlyCheckoutFreeHours: number | null;
  earlyCheckoutRefundPct: number;
  tiers: readonly CancellationTierSeed[];
}

/** 4 chính sách + 11 bậc — `chinh-sach-huy-hoan-coc.md` §2, §3. */
export const CANCELLATION_POLICIES: readonly CancellationPolicySeed[] = [
  {
    code: 'CP-FLEX7',
    name: 'Linh hoạt 7 ngày (FLEX7)',
    isDefault: true,
    earlyCheckoutFreeHours: 72,
    earlyCheckoutRefundPct: 50,
    tiers: [
      {
        offsetHours: 168,
        refundPercent: 100,
        chargeFirstNight: false,
        label: 'Huỷ trước ≥ 7 ngày: hoàn toàn bộ',
        sortOrder: 1,
      },
      {
        offsetHours: 72,
        refundPercent: 50,
        chargeFirstNight: false,
        label: 'Huỷ trước 3–7 ngày: hoàn 50%',
        sortOrder: 2,
      },
      {
        offsetHours: 24,
        refundPercent: 0,
        chargeFirstNight: false,
        label: 'Huỷ trước 1–3 ngày: không hoàn cọc',
        sortOrder: 3,
      },
      {
        offsetHours: -1,
        refundPercent: 0,
        chargeFirstNight: true,
        label: 'Huỷ dưới 24 giờ: mất cọc + phụ thu 1 đêm',
        sortOrder: 4,
      },
    ],
  },
  {
    code: 'CP-SAVER3',
    name: 'Tiết kiệm 3 ngày (SAVER3)',
    isDefault: false,
    earlyCheckoutFreeHours: 72,
    earlyCheckoutRefundPct: 50,
    tiers: [
      {
        offsetHours: 72,
        refundPercent: 100,
        chargeFirstNight: false,
        label: 'Huỷ trước ≥ 3 ngày: hoàn toàn bộ',
        sortOrder: 1,
      },
      {
        offsetHours: 24,
        refundPercent: 50,
        chargeFirstNight: false,
        label: 'Huỷ trước 1–3 ngày: hoàn 50%',
        sortOrder: 2,
      },
      {
        offsetHours: -1,
        refundPercent: 0,
        chargeFirstNight: true,
        label: 'Huỷ dưới 24 giờ: mất cọc + phụ thu 1 đêm',
        sortOrder: 3,
      },
    ],
  },
  {
    code: 'CP-NONREF',
    name: 'Không hoàn (NONREF)',
    isDefault: false,
    earlyCheckoutFreeHours: null,
    earlyCheckoutRefundPct: 0,
    tiers: [
      {
        offsetHours: -1,
        refundPercent: 0,
        chargeFirstNight: false,
        label: 'Không hoàn tiền ở mọi mốc',
        sortOrder: 1,
      },
    ],
  },
  {
    code: 'CP-LONGSTAY14',
    name: 'Dài ngày 14 ngày (LONGSTAY14)',
    isDefault: false,
    earlyCheckoutFreeHours: 168,
    earlyCheckoutRefundPct: 50,
    tiers: [
      {
        offsetHours: 336,
        refundPercent: 100,
        chargeFirstNight: false,
        label: 'Huỷ trước ≥ 14 ngày: hoàn toàn bộ',
        sortOrder: 1,
      },
      {
        offsetHours: 168,
        refundPercent: 50,
        chargeFirstNight: false,
        label: 'Huỷ trước 7–14 ngày: hoàn 50%',
        sortOrder: 2,
      },
      {
        offsetHours: -1,
        refundPercent: 0,
        chargeFirstNight: true,
        label: 'Huỷ dưới 7 ngày: không hoàn, phụ thu 1 đêm',
        sortOrder: 3,
      },
    ],
  },
];

export interface RatePlanSeed {
  code: string;
  name: string;
  policyCode: string;
  depositPercent: number;
  minNights: number;
  maxNights: number;
  losDiscountEnabled: boolean;
  rescheduleAllowed: boolean;
  rescheduleMinHours: number;
  rescheduleFeePct: number;
  maxReschedules: number;
}

/** 4 gói giá — cọc Q-01, đổi ngày Q-12, LOS theo `dong-gia.md` §4.4. */
export const RATE_PLANS: readonly RatePlanSeed[] = [
  {
    code: 'FLEX7',
    name: 'Linh hoạt 7 ngày',
    policyCode: 'CP-FLEX7',
    depositPercent: 30,
    minNights: 1,
    maxNights: 365,
    losDiscountEnabled: true,
    rescheduleAllowed: true,
    rescheduleMinHours: 168,
    rescheduleFeePct: 0,
    maxReschedules: 1,
  },
  {
    code: 'SAVER3',
    name: 'Tiết kiệm 3 ngày',
    policyCode: 'CP-SAVER3',
    depositPercent: 50,
    minNights: 3,
    maxNights: 365,
    losDiscountEnabled: true,
    rescheduleAllowed: true,
    rescheduleMinHours: 168,
    rescheduleFeePct: 0,
    maxReschedules: 1,
  },
  {
    code: 'NONREF',
    name: 'Không hoàn tiền',
    policyCode: 'CP-NONREF',
    depositPercent: 100,
    minNights: 1,
    maxNights: 365,
    losDiscountEnabled: false,
    rescheduleAllowed: true,
    rescheduleMinHours: 168,
    rescheduleFeePct: 10,
    maxReschedules: 1,
  },
  {
    code: 'LONGSTAY14',
    name: 'Dài ngày 14 đêm',
    policyCode: 'CP-LONGSTAY14',
    depositPercent: 30,
    minNights: 14,
    maxNights: 365,
    losDiscountEnabled: true,
    rescheduleAllowed: true,
    rescheduleMinHours: 168,
    rescheduleFeePct: 0,
    maxReschedules: 1,
  },
];
