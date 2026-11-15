/**
 * Nội dung trang hạng phòng (`/room-types/[code]`, "hạng khoang") — HB-310. 5 trang dùng chung toàn chuỗi
 * (quyết định Q3); đợt 3 có DLX, HB-311 thêm đủ bốn hạng còn lại.
 *
 * Thông số chỉ gồm thứ có nguồn: tên, khoang, sức chứa lấy từ nội dung trang chủ (khớp dữ liệu seed
 * `apps/api/prisma/seed/reference-data.ts`), số chỗ ngủ (`bedCount`), có ở ga nào. Không có diện tích, view,
 * tiện nghi hay giá: giá luôn in theo từng đêm ở bước tìm phòng.
 */
import type { Locale } from '../i18n/locales';
import { CONTENT_PACKS } from './locale-packs';

import { ROOM_TYPE_CODES, type RoomTypeCode } from './room-type-codes';

export { ROOM_TYPE_CODES, type RoomTypeCode };

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
  /** Bố cục khoang theo số chỗ ngủ (HB-322, CONT-01); không diện tích, view hay tiện nghi. */
  readonly layout: string;
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
  {
    code: 'STD',
    sleeps: 2,
    stationCodes: ['DL', 'PT', 'VT'],
    photoId: 'hang-STD',
    galleryIds: ['hang-STD'],
  },
  {
    code: 'SUP',
    sleeps: 2,
    stationCodes: ['DL', 'PT', 'VT'],
    photoId: 'hang-SUP',
    galleryIds: ['hang-SUP'],
  },
  {
    code: 'FAM',
    sleeps: 4,
    stationCodes: ['DL', 'PT', 'VT'],
    photoId: 'hang-FAM',
    galleryIds: ['hang-FAM'],
  },
  {
    code: 'DOR',
    sleeps: 6,
    stationCodes: ['DL', 'PT', 'VT'],
    photoId: 'hang-DOR',
    galleryIds: ['hang-DOR'],
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
      layout:
        'Ba chỗ ngủ trong cùng một khoang: người thứ ba có chỗ nằm riêng, không phải ghép giường hay đặt thêm phòng.',
      seoTitle: 'Hạng Deluxe (khoang ba) · Pine Hill',
      seoDescription:
        'Hạng Deluxe của Pine Hill: chỗ ngủ cho ba người lớn, có ở cả ba cơ sở Đà Lạt, Phan Thiết, Vũng Tàu. Giá in theo từng đêm khi chọn ngày.',
      illustrative: true,
    },
    STD: {
      summary: 'Khoang đôi gọn: một phòng cho hai người lớn, đủ cho chuyến đi ngắn.',
      description: [
        'Standard là hạng cơ bản của tuyến: một phòng gọn cho hai người, có đủ tiện nghi cơ bản đã gồm trong giá. Hợp với chuyến đi một hai đêm, khi phần lớn thời gian bạn ở ngoài.',
        'Giá Standard tính theo từng đêm và thay đổi theo mùa, ngày cuối tuần và số đêm bạn ở. Chọn ga và ngày ở bước tìm phòng để thấy giá in trên từng chặng trước khi giữ chỗ.',
      ],
      suits: 'Cặp đôi hoặc hai người bạn đi ngắn ngày',
      layout:
        'Hai chỗ ngủ trong một khoang gọn. Đủ chỗ đặt hai vali và đi lại thoải mái; hợp với chuyến một, hai đêm.',
      seoTitle: 'Hạng Standard (khoang đôi) · Pine Hill',
      seoDescription:
        'Hạng Standard của Pine Hill: phòng cho hai người lớn, có ở cả ba cơ sở Đà Lạt, Phan Thiết, Vũng Tàu. Giá in theo từng đêm khi chọn ngày.',
      illustrative: true,
    },
    SUP: {
      summary: 'Khoang đôi rộng: rộng hơn Standard, hợp khi ở từ hai đêm trở lên.',
      description: [
        'Superior vẫn dành cho hai người lớn nhưng phòng rộng hơn Standard, có thêm chỗ để đồ và ngồi. Ở lâu hơn hai đêm thì khoảng trống này đáng giá.',
        'Giá Superior tính theo từng đêm và thay đổi theo mùa, ngày cuối tuần và số đêm bạn ở; ở từ ba đêm có hệ số giảm theo độ dài kỳ ở. Chọn ga và ngày để thấy giá từng chặng.',
      ],
      suits: 'Hai người ở từ ba đêm trở lên',
      layout:
        'Hai chỗ ngủ như Standard nhưng khoang rộng hơn, thêm khoảng trống để ngồi và bày đồ cho kỳ ở dài.',
      seoTitle: 'Hạng Superior (khoang đôi rộng) · Pine Hill',
      seoDescription:
        'Hạng Superior của Pine Hill: phòng rộng cho hai người lớn, có ở cả ba cơ sở. Giá in theo từng đêm khi chọn ngày.',
      illustrative: true,
    },
    FAM: {
      summary:
        'Khoang bốn: một phòng đủ chỗ ngủ cho bốn người lớn, cho gia đình hoặc nhóm bốn người.',
      description: [
        'Family dành cho bốn người đi cùng nhau: gia đình có con lớn, hai cặp đôi, hay nhóm bạn. Bốn chỗ ngủ trong một phòng, không phải chia ra hai phòng.',
        'Giá Family tính theo từng đêm và thay đổi theo mùa, ngày cuối tuần và số đêm bạn ở. Nhóm bốn người muốn ăn sáng cùng giờ thì báo trước cho ga.',
      ],
      suits: 'Gia đình hoặc nhóm bốn người lớn',
      layout:
        'Bốn chỗ ngủ trong cùng một khoang: cả nhóm ở chung một cửa, không phải chia hai phòng.',
      seoTitle: 'Hạng Family (khoang bốn) · Pine Hill',
      seoDescription:
        'Hạng Family của Pine Hill: chỗ ngủ cho bốn người lớn trong một phòng, có ở cả ba cơ sở. Giá in theo từng đêm khi chọn ngày.',
      illustrative: true,
    },
    DOR: {
      summary:
        'Khoang sáu giường, bán theo giường: mỗi khách đặt một giường trong phòng sáu giường.',
      description: [
        'Dorm hợp với người đi một mình hoặc nhóm nhỏ muốn tiết kiệm. Mỗi giường có rèm che, đèn đọc sách, ổ cắm và tủ khoá riêng; phòng tắm dùng chung trong phòng.',
        'Giá Dorm tính theo giường và theo từng đêm. Phòng có sáu giường nên bạn ở cùng khách khác; nhóm đông có thể đặt nhiều giường trong cùng một lần đặt.',
      ],
      suits: 'Người đi một mình hoặc nhóm nhỏ tiết kiệm',
      layout:
        'Sáu giường trong một phòng chung. Bạn đặt từng giường; người cùng phòng có thể là khách khác.',
      seoTitle: 'Hạng Dorm (khoang sáu giường) · Pine Hill',
      seoDescription:
        'Hạng Dorm của Pine Hill: giường trong phòng sáu giường, có rèm, đèn và tủ khoá riêng; có ở cả ba cơ sở. Giá in theo từng đêm khi chọn ngày.',
      illustrative: true,
    },
  },
  en: {
    DLX: {
      summary:
        'Triple cabin: one room with sleeping places for three adults, so a group of three does not need a second room.',
      description: [
        'Deluxe is the class for three people travelling together: a couple with a parent, three friends, or a family with an older child. Everyone gets their own sleeping place in the same room.',
        'Deluxe is priced night by night and varies with the season, weekends and how many nights you stay. Choose a station and dates in the search to see the price printed on each leg before you hold.',
      ],
      suits: 'Groups of three adults, or families with an older child',
      layout:
        'Three sleeping places in one cabin: the third guest has a place of their own, with no sharing a bed and no second room.',
      seoTitle: 'Deluxe class (triple cabin) · Pine Hill',
      seoDescription:
        'Pine Hill Deluxe: sleeping places for three adults, available at all three properties in Da Lat, Phan Thiet and Vung Tau. Prices shown night by night once you pick dates.',
      illustrative: true,
    },
    STD: {
      summary: 'Double cabin: a compact room for two adults, right for short trips.',
      description: [
        'Standard is the basic class on the line: a compact room for two, with the basic amenities included in the price. It suits a trip of a night or two, when you spend most of the day out.',
        'Standard is priced night by night and varies with the season, weekends and how many nights you stay. Choose a station and dates in the search to see the price printed on each leg before you hold.',
      ],
      suits: 'Couples or two friends on a short trip',
      layout:
        'Two sleeping places in a compact cabin, with room for two suitcases and space to move around; suits a stay of one or two nights.',
      seoTitle: 'Standard class (double cabin) · Pine Hill',
      seoDescription:
        'Pine Hill Standard: a room for two adults, available at all three properties in Da Lat, Phan Thiet and Vung Tau. Prices shown night by night once you pick dates.',
      illustrative: true,
    },
    SUP: {
      summary: 'Large double cabin: roomier than Standard, good for stays of two nights or more.',
      description: [
        'Superior is still for two adults, but the room is larger than Standard, with more space to unpack and sit. On stays longer than two nights the extra space is worth it.',
        'Superior is priced night by night and varies with the season, weekends and how many nights you stay; from three nights a length-of-stay factor lowers the price. Choose a station and dates to see each leg.',
      ],
      suits: 'Two people staying three nights or more',
      layout:
        'Two sleeping places like the Standard, in a larger cabin with extra space to sit and unpack for a longer stay.',
      seoTitle: 'Superior class (large double cabin) · Pine Hill',
      seoDescription:
        'Pine Hill Superior: a larger room for two adults, available at all three properties. Prices shown night by night once you pick dates.',
      illustrative: true,
    },
    FAM: {
      summary:
        'Four-berth cabin: one room with sleeping places for four adults, for a family or a group of four.',
      description: [
        'Family is for four people travelling together: a family with older children, two couples, or a group of friends. Four sleeping places in one room, with no need to split across two rooms.',
        'Family is priced night by night and varies with the season, weekends and how many nights you stay. Groups of four who want breakfast together should let the station know ahead.',
      ],
      suits: 'Families or groups of four adults',
      layout:
        'Four sleeping places in one cabin: the whole group behind one door, with no need to split across two rooms.',
      seoTitle: 'Family class (four-berth cabin) · Pine Hill',
      seoDescription:
        'Pine Hill Family: sleeping places for four adults in one room, available at all three properties. Prices shown night by night once you pick dates.',
      illustrative: true,
    },
    DOR: {
      summary: 'Six-berth cabin, sold by the bed: each guest books one bed in a six-bed room.',
      description: [
        'Dorm suits solo travellers or small groups on a budget. Every bed has its own curtain, reading light, power socket and locker; the bathroom is shared within the room.',
        'Dorm is priced per bed, night by night. The room has six beds, so you share it with other guests; a larger group can book several beds in one booking.',
      ],
      suits: 'Solo travellers or small groups on a budget',
      layout: 'Six beds in a shared room. You book by the bed; your roommates may be other guests.',
      seoTitle: 'Dorm class (six-berth cabin) · Pine Hill',
      seoDescription:
        'Pine Hill Dorm: a bed in a six-bed room with its own curtain, light and locker, available at all three properties. Prices shown night by night once you pick dates.',
      illustrative: true,
    },
  },
  'zh-CN': CONTENT_PACKS['zh-CN'].roomTypes,
  ja: CONTENT_PACKS.ja.roomTypes,
  ko: CONTENT_PACKS.ko.roomTypes,
  ru: CONTENT_PACKS.ru.roomTypes,
};

export function roomTypePageKey(code: string): RoomTypePageKey | undefined {
  return ROOM_TYPE_PAGES.find((page) => page.code === code);
}

export function roomTypePageCopy(code: RoomTypeCode, locale: Locale): RoomTypePageCopy | undefined {
  return COPY[locale][code];
}
