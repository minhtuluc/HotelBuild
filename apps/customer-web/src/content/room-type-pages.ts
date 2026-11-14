/**
 * Nội dung trang hạng phòng (`/room-types/[code]`, "hạng khoang") — HB-310. 5 trang dùng chung toàn chuỗi
 * (quyết định Q3); đợt 3 mới có DLX.
 *
 * Thông số chỉ gồm thứ có nguồn: tên, khoang, sức chứa lấy từ nội dung trang chủ (khớp dữ liệu seed
 * `apps/api/prisma/seed/reference-data.ts`), số chỗ ngủ (`bedCount`), có ở ga nào. Không có diện tích, view,
 * tiện nghi hay giá: giá luôn in theo từng đêm ở bước tìm phòng.
 */
import type { Locale } from '../i18n/locales';

export type RoomTypeCode = 'STD' | 'SUP' | 'DLX' | 'FAM' | 'DOR';

export const ROOM_TYPE_CODES: readonly RoomTypeCode[] = ['STD', 'SUP', 'DLX', 'FAM', 'DOR'];

export interface RoomTypePageKey {
  readonly code: RoomTypeCode;
  /** Số chỗ ngủ (seed `bedCount`). */
  readonly sleeps: number;
  /** Mã ga có bán hạng này (seed: cả ba cơ sở đều có đủ năm hạng). */
  readonly stationCodes: readonly string[];
  readonly photoId: string;
  readonly galleryIds: readonly string[];
}

export interface RoomTypePageCopy {
  readonly summary: string;
  readonly description: readonly string[];
  readonly suits: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly illustrative: true;
}

export const ROOM_TYPE_PAGES: readonly RoomTypePageKey[] = [
  {
    code: 'DLX',
    sleeps: 3,
    stationCodes: ['DL', 'PT', 'VT'],
    photoId: 'hang-DLX',
    /** Chỉ ảnh đúng hạng; ảnh phòng của từng ga không chắc là hạng này nên không đưa vào. */
    galleryIds: ['hang-DLX'],
  },
];

const COPY: Readonly<Record<Locale, Partial<Readonly<Record<RoomTypeCode, RoomTypePageCopy>>>>> = {
  vi: {
    DLX: {
      summary:
        'Khoang ba: một phòng đủ chỗ ngủ cho ba người lớn, để nhóm ba người không phải đặt thêm phòng thứ hai.',
      description: [
        'Deluxe là hạng dành cho ba người đi cùng nhau: cặp đôi đi với bố hoặc mẹ, ba người bạn, hoặc gia đình có con đã lớn. Mỗi người có chỗ ngủ riêng trong cùng một phòng.',
        'Giá Deluxe tính theo từng đêm và thay đổi theo mùa, ngày cuối tuần và số đêm bạn ở. Chọn ga và ngày ở bước tìm phòng để thấy giá in trên từng chặng trước khi giữ chỗ.',
      ],
      suits: 'Nhóm ba người lớn, hoặc gia đình có con lớn',
      seoTitle: 'Hạng Deluxe (khoang ba) · Pine Hill',
      seoDescription:
        'Hạng Deluxe của Pine Hill: chỗ ngủ cho ba người lớn, có ở cả ba cơ sở Đà Lạt, Phan Thiết, Vũng Tàu. Giá in theo từng đêm khi chọn ngày.',
      illustrative: true,
    },
  },
};

export function roomTypePageKey(code: string): RoomTypePageKey | undefined {
  return ROOM_TYPE_PAGES.find((page) => page.code === code);
}

export function roomTypePageCopy(code: RoomTypeCode, locale: Locale): RoomTypePageCopy | undefined {
  return COPY[locale][code];
}
