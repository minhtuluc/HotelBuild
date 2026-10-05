/**
 * Dữ liệu tham chiếu của đề tài Pine Hill (HB-018) — chỉ số liệu đã có nguồn, không suy diễn thêm.
 *
 * Nguồn:
 * - Ma trận phòng theo cơ sở × loại phòng: BR-PROP-03/04 (`02-nghiep-vu/quy-tac-nghiep-vu.md` §BR-PROP).
 * - Giá cơ bản, sàn/trần: BR-RATE-03/04.
 * - Kênh (hệ số, hoa hồng, hold, oversell): bảng kênh BR-RATE-07; hoa hồng OTA: Q-03.
 * - Cọc gói giá: Q-01; đổi ngày: Q-12; trả phòng sớm: Q-11; phí hoàn: BR-CANCEL-11 (= 0).
 * - Bậc huỷ: `02-nghiep-vu/chinh-sach-huy-hoan-coc.md` §2, §3 (4 chính sách, 11 bậc).
 * - Tham số hệ thống: BR-SYS-02 (kèm `pricing.occupancyMidPct`/`occupancyHighPct` theo BR-RATE-01).
 */

export interface PropertySeed {
  code: string;
  name: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  /** Số phòng theo loại (BR-PROP-03). */
  rooms: Readonly<Record<RoomTypeCode, number>>;
}

export type RoomTypeCode = 'STD' | 'SUP' | 'DLX' | 'FAM' | 'DOR';

export interface RoomTypeSeed {
  code: RoomTypeCode;
  name: string;
  capacityAdults: number;
  basePrice: number;
  minPrice: number;
  maxPrice: number;
  bedCount: number;
  allowShared: boolean;
}

export const PROPERTIES: readonly PropertySeed[] = [
  {
    code: 'CS-01',
    name: 'Pine Hill Đà Lạt',
    address: 'Số 1 đường Trần Phú, Đà Lạt, Lâm Đồng (địa chỉ dev)',
    phone: '+842633000001',
    latitude: 11.9404,
    longitude: 108.4583,
    rooms: { STD: 8, SUP: 6, DLX: 5, FAM: 3, DOR: 2 },
  },
  {
    code: 'CS-02',
    name: 'Pine Hill Vũng Tàu',
    address: 'Số 2 đường Thùy Vân, Vũng Tàu, Bà Rịa – Vũng Tàu (địa chỉ dev)',
    phone: '+842543000002',
    latitude: 10.346,
    longitude: 107.0843,
    rooms: { STD: 7, SUP: 4, DLX: 4, FAM: 2, DOR: 1 },
  },
  {
    code: 'CS-03',
    name: 'Pine Hill Phan Thiết',
    address: 'Số 3 đường Nguyễn Đình Chiểu, Phan Thiết, Bình Thuận (địa chỉ dev)',
    phone: '+842523000003',
    latitude: 10.9333,
    longitude: 108.1,
    rooms: { STD: 5, SUP: 3, DLX: 3, FAM: 1, DOR: 1 },
  },
];

/** BR-PROP-04: DOR bán theo giường (`bedCount` 6); loại khác `bedCount = capacityAdults`. */
export const ROOM_TYPES: readonly RoomTypeSeed[] = [
  {
    code: 'STD',
    name: 'Standard',
    capacityAdults: 2,
    basePrice: 650_000,
    minPrice: 400_000,
    maxPrice: 1_800_000,
    bedCount: 2,
    allowShared: false,
  },
  {
    code: 'SUP',
    name: 'Superior',
    capacityAdults: 2,
    basePrice: 850_000,
    minPrice: 520_000,
    maxPrice: 2_400_000,
    bedCount: 2,
    allowShared: false,
  },
  {
    code: 'DLX',
    name: 'Deluxe',
    capacityAdults: 3,
    basePrice: 1_100_000,
    minPrice: 680_000,
    maxPrice: 3_000_000,
    bedCount: 3,
    allowShared: false,
  },
  {
    code: 'FAM',
    name: 'Family',
    capacityAdults: 4,
    basePrice: 1_600_000,
    minPrice: 980_000,
    maxPrice: 4_200_000,
    bedCount: 4,
    allowShared: false,
  },
  {
    code: 'DOR',
    name: 'Dorm giường',
    capacityAdults: 6,
    basePrice: 250_000,
    minPrice: 150_000,
    maxPrice: 700_000,
    bedCount: 6,
    allowShared: true,
  },
];

export interface ChannelSeed {
  code: string;
  name: string;
  multiplier: number;
  commissionPct: number;
  holdMinutes: number;
  overbookAllowed: boolean;
}

/** Bảng kênh BR-RATE-07 (hoa hồng OTA theo Q-03). */
export const CHANNELS: readonly ChannelSeed[] = [
  {
    code: 'WEB',
    name: 'Website trực tiếp',
    multiplier: 1,
    commissionPct: 0,
    holdMinutes: 20,
    overbookAllowed: false,
  },
  {
    code: 'PHONE',
    name: 'Điện thoại / CSKH',
    multiplier: 1,
    commissionPct: 0,
    holdMinutes: 1440,
    overbookAllowed: false,
  },
  {
    code: 'WALKIN',
    name: 'Khách vãng lai tại quầy',
    multiplier: 1.1,
    commissionPct: 0,
    holdMinutes: 0,
    overbookAllowed: false,
  },
  {
    code: 'AGENCY',
    name: 'Đại lý / doanh nghiệp',
    multiplier: 0.95,
    commissionPct: 10,
    holdMinutes: 1440,
    overbookAllowed: false,
  },
  {
    code: 'OTA_BOOKING',
    name: 'Booking.com',
    multiplier: 1.25,
    commissionPct: 18,
    holdMinutes: 0,
    overbookAllowed: true,
  },
  {
    code: 'OTA_AGODA',
    name: 'Agoda',
    multiplier: 1.22,
    commissionPct: 17,
    holdMinutes: 0,
    overbookAllowed: true,
  },
  {
    code: 'OTA_AIRBNB',
    name: 'Airbnb',
    multiplier: 1.19,
    commissionPct: 15,
    holdMinutes: 0,
    overbookAllowed: true,
  },
];

/** Mã phòng theo loại: `STD01..`; DOR đánh số riêng. Tầng gán theo loại (thông tin vận hành). */
export const FLOOR_BY_ROOM_TYPE: Readonly<Record<RoomTypeCode, number>> = {
  STD: 1,
  SUP: 2,
  DLX: 3,
  FAM: 4,
  DOR: 4,
};

export function roomCode(typeCode: RoomTypeCode, index: number): string {
  return `${typeCode}${String(index).padStart(2, '0')}`;
}
