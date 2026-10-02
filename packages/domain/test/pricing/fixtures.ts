import type { PricingInput, Season, Promotion } from '../../src/pricing/index.js';
export const rooms = {
  STD: { id: 'STD', basePrice: 650000, minPrice: 400000, maxPrice: 1800000 },
  SUP: { id: 'SUP', basePrice: 850000, minPrice: 520000, maxPrice: 2400000 },
  DLX: { id: 'DLX', basePrice: 1100000, minPrice: 680000, maxPrice: 3000000 },
  FAM: { id: 'FAM', basePrice: 1600000, minPrice: 980000, maxPrice: 4200000 },
  DOR: { id: 'DOR', basePrice: 250000, minPrice: 150000, maxPrice: 700000 },
};
export const seasons: readonly Season[] = [
  {
    id: 'LOW',
    from: '2026-10-01',
    to: '2026-12-29',
    priority: 20,
    multiplier: '0.85',
    weekendSurchargeEnabled: true,
    createdAt: 1,
  },
  {
    id: 'SHO',
    from: '2026-08-16',
    to: '2026-09-30',
    priority: 30,
    multiplier: '0.90',
    weekendSurchargeEnabled: true,
    createdAt: 1,
  },
  {
    id: 'SUM',
    from: '2026-06-01',
    to: '2026-08-15',
    priority: 50,
    multiplier: '1.40',
    weekendSurchargeEnabled: true,
    createdAt: 1,
  },
  {
    id: 'REUN',
    from: '2026-04-28',
    to: '2026-05-03',
    priority: 80,
    multiplier: '1.80',
    weekendSurchargeEnabled: false,
    createdAt: 1,
  },
  {
    id: 'NY',
    from: '2026-12-30',
    to: '2027-01-02',
    priority: 90,
    multiplier: '2.20',
    weekendSurchargeEnabled: false,
    createdAt: 1,
  },
];
export function input(
  room: keyof typeof rooms = 'STD',
  checkIn = '2026-11-17',
  checkOut = '2026-11-18',
  channelCode = 'WEB',
): PricingInput {
  return {
    propertyId: 'CS',
    room: rooms[room],
    checkIn,
    checkOut,
    channelCode,
    now: 1000000,
    ratePlan: {
      id: 'FLEX7',
      minNights: 1,
      maxNights: 90,
      losDiscountEnabled: true,
      depositPercent: '30',
    },
    seasons,
    calendar: [],
    occupancy: [],
    channelSettings: [],
    promotions: [],
    channels: [
      { code: 'WEB', multiplier: '1', commissionPercent: '0' },
      { code: 'PHONE', multiplier: '1', commissionPercent: '0' },
      { code: 'WALKIN', multiplier: '1.10', commissionPercent: '0' },
      { code: 'AGENCY', multiplier: '0.95', commissionPercent: '10' },
      { code: 'OTA_BOOKING', multiplier: '1.25', commissionPercent: '18' },
      { code: 'OTA_AGODA', multiplier: '1.22', commissionPercent: '17' },
      { code: 'OTA_AIRBNB', multiplier: '1.19', commissionPercent: '15' },
    ],
    settings: {
      weekendMultiplier: '1.20',
      occupancyMidPercent: '80',
      occupancyHighPercent: '95',
      occupancyMidMultiplier: '1.15',
      occupancyHighMultiplier: '1.25',
      occupancyFreshnessMs: 300000,
      maxDiscountPercent: '30',
      los: [
        { minNights: 3, multiplier: '0.95' },
        { minNights: 7, multiplier: '0.90' },
        { minNights: 14, multiplier: '0.85' },
      ],
    },
  };
}
export function promo(code: string, kind: 'AMOUNT' | 'PERCENT', value: string): Promotion {
  return {
    code,
    kind,
    value,
    stackable: true,
    validFrom: 0,
    validTo: 2000000,
    uses: 0,
    maxUses: 10,
  };
}
export { matrix } from './fixtures/matrix.js';
