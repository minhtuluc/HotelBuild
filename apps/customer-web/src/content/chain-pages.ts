/**
 * Trang toàn chuỗi (HB-311b): `/getting-here`, `/experiences`, `/offers`, `/gallery`.
 *
 * Hai lớp như trang ga:
 * - Khoá không đổi theo ngôn ngữ: hoạt động quanh ga (ga, tháng), hệ số theo số đêm và thông số 4 gói giá.
 *   Hệ số và thông số gói chép từ `docs/02-nghiep-vu/quy-tac-nghiep-vu.md` §4.4; test đọc lại tài liệu để
 *   bắt lệch. Frontend không tính giá bằng các số này, chỉ in ra cho khách đọc.
 * - Câu chữ theo locale: `COPY` cho `vi`/`en`, gói nội dung (`locale-packs/`) cho locale thêm sau.
 *
 * Phần tả nơi chốn và hoạt động là MINH HOẠ (`illustrative: true`). Không có giá, mã khuyến mãi, lịch sự kiện
 * có ngày cụ thể hay so sánh với kênh trung gian (kế hoạch §8.2, Q15).
 */
import type { Locale } from '../i18n/locales';
import { CONTENT_PACKS } from './locale-packs';

export interface ExperienceKey {
  readonly id: string;
  /** Mã ga trên tuyến (`DL`, `PT`, `VT`). */
  readonly stationCode: string;
  /** Tháng (1–12) đẹp nhất; `null` là quanh năm. */
  readonly months: readonly number[] | null;
}

export const EXPERIENCES: readonly ExperienceKey[] = [
  { id: 'dl-pine-walk', stationCode: 'DL', months: null },
  { id: 'dl-lake-ride', stationCode: 'DL', months: null },
  { id: 'dl-wild-sunflowers', stationCode: 'DL', months: [11, 12] },
  { id: 'pt-dunes', stationCode: 'PT', months: null },
  { id: 'pt-kitesurf', stationCode: 'PT', months: [11, 12, 1, 2, 3, 4] },
  { id: 'pt-fishing-village', stationCode: 'PT', months: null },
  { id: 'vt-lighthouse', stationCode: 'VT', months: null },
  { id: 'vt-early-swim', stationCode: 'VT', months: null },
  { id: 'vt-small-mountain', stationCode: 'VT', months: [11, 12, 1, 2, 3, 4] },
];

/** Hệ số độ dài kỳ ở (docs/02 §4.4), áp cho mọi đêm của kỳ khi gói bật giảm theo số đêm. */
export const LOS_TIERS: readonly {
  readonly fromNights: number;
  readonly toNights: number | null;
  readonly factor: number;
}[] = [
  { fromNights: 3, toNights: 6, factor: 0.95 },
  { fromNights: 7, toNights: 13, factor: 0.9 },
  { fromNights: 14, toNights: null, factor: 0.85 },
];

export type PlanCode = 'FLEX7' | 'SAVER3' | 'LONGSTAY14' | 'NONREF';

/** Thông số mặc định của 4 gói (docs/02 §4.4, bảng "Giá trị mặc định của 4 gói giá"). */
export const PLAN_FACTS: Readonly<
  Record<
    PlanCode,
    {
      readonly minNights: number;
      readonly losDiscount: boolean;
      readonly reschedule: 'free' | 'fee';
    }
  >
> = {
  FLEX7: { minNights: 1, losDiscount: true, reschedule: 'free' },
  SAVER3: { minNights: 2, losDiscount: true, reschedule: 'free' },
  NONREF: { minNights: 1, losDiscount: false, reschedule: 'fee' },
  LONGSTAY14: { minNights: 14, losDiscount: true, reschedule: 'free' },
};

export function isPlanCode(code: string): code is PlanCode {
  return Object.hasOwn(PLAN_FACTS, code);
}

/** Cổng thị thực điện tử chính thức của Việt Nam (chỉ đặt link, không diễn giải quy định). */
export const EVISA_URL = 'https://evisa.gov.vn/';

export interface ChainPagesCopy {
  readonly gettingHere: {
    readonly summary: string;
    /** Khối khách quốc tế: các dòng tả chặng nối từ sân bay quốc tế. */
    readonly international: readonly string[];
    readonly seoTitle: string;
    readonly seoDescription: string;
  };
  readonly experiences: {
    readonly summary: string;
    /** Theo `ExperienceKey.id`. */
    readonly items: Readonly<Record<string, { readonly name: string; readonly body: string }>>;
    readonly seoTitle: string;
    readonly seoDescription: string;
  };
  readonly offers: {
    readonly summary: string;
    readonly losBody: string;
    readonly terms: readonly string[];
    readonly seoTitle: string;
    readonly seoDescription: string;
  };
  readonly gallery: {
    readonly summary: string;
    readonly seoTitle: string;
    readonly seoDescription: string;
  };
  readonly illustrative: true;
}

const VI: ChainPagesCopy = {
  gettingHere: {
    summary:
      'Ba ga nằm trên một tuyến từ cao nguyên xuống biển, đều đi được trong ngày từ TP.HCM. Bảng dưới in từng chặng của từng ga; thời gian là ước lượng.',
    international: [
      'Bay quốc tế vào sân bay Tân Sơn Nhất (TP.HCM), rồi nối chặng theo bảng của ga bạn chọn.',
      'Đi Đà Lạt có thể nối chuyến bay nội địa ngay trong ngày; đi Phan Thiết và Vũng Tàu thì đi tiếp bằng đường bộ, tàu hoả hoặc tàu cao tốc.',
      'Kiểm tra yêu cầu thị thực trước chuyến đi trên cổng chính thức bên dưới.',
    ],
    seoTitle: 'Đường đến ba ga · Pine Hill',
    seoDescription:
      'Đường đến Đà Lạt, Phan Thiết và Vũng Tàu: máy bay, tàu hoả, cao tốc, tàu cao tốc, thời gian ước lượng từng chặng và lưu ý cho khách quốc tế.',
  },
  experiences: {
    summary:
      'Mỗi ga có nhịp riêng. Đây là vài việc đáng làm quanh ga, gắn với mùa đẹp nhất; không phải tour, không cần đặt trước qua Pine Hill.',
    items: {
      'dl-pine-walk': {
        name: 'Đi bộ rừng thông buổi sớm',
        body: 'Đi trước chín giờ, khi sương còn phủ đồi thông. Đường mòn quanh cơ sở đi một vòng mất khoảng một giờ.',
      },
      'dl-lake-ride': {
        name: 'Đạp xe quanh hồ',
        body: 'Một vòng hồ đường bằng, hợp đi buổi trưa khi nắng nhẹ. Thuê xe ở các điểm quanh hồ.',
      },
      'dl-wild-sunflowers': {
        name: 'Dã quỳ và biển mây',
        body: 'Cuối năm dã quỳ nở vàng ven đồi; sáng sớm trời quang thường thấy mây phủ thung lũng.',
      },
      'pt-dunes': {
        name: 'Đồi cát lúc bình minh',
        body: 'Lên đồi trước bảy giờ, khi cát còn mát. Mang nước và giày đi cát.',
      },
      'pt-kitesurf': {
        name: 'Xem lướt ván diều',
        body: 'Mùa gió, bãi biển kín cánh diều từ trưa tới chiều. Ngồi xem trên bờ hoặc học thử ở các trường quanh bãi.',
      },
      'pt-fishing-village': {
        name: 'Làng chài buổi chiều',
        body: 'Thuyền thúng về bến lúc chiều; đi dọc bờ xem người làng phân loại cá.',
      },
      'vt-lighthouse': {
        name: 'Hải đăng lúc hoàng hôn',
        body: 'Đường lên dốc, đi bộ khoảng 30 phút. Đi lúc chiều muộn để nhìn vịnh khi mặt trời xuống.',
      },
      'vt-early-swim': {
        name: 'Tắm biển sớm',
        body: 'Người địa phương xuống biển từ năm giờ sáng. Nước êm và mát nhất trước khi nắng lên.',
      },
      'vt-small-mountain': {
        name: 'Đi bộ quanh núi Nhỏ',
        body: 'Mùa khô gió mát, con đường men núi nhìn ra biển hợp đi bộ hoặc đạp xe.',
      },
    },
    seoTitle: 'Trải nghiệm quanh ga · Pine Hill',
    seoDescription:
      'Việc đáng làm quanh ga Đà Lạt, Phan Thiết và Vũng Tàu, theo mùa đẹp nhất của từng nơi.',
  },
  offers: {
    summary:
      'Pine Hill không có mã giảm giá hay khuyến mãi treo. Giá rẻ hơn đến từ quy tắc cố định: ở càng lâu, mỗi đêm càng thấp, và gói giá bạn chọn quyết định cọc, đổi ngày, hoàn tiền.',
    losBody:
      'Khi gói giá có bật giảm theo số đêm, hệ số áp cho mọi đêm của kỳ ở, không chỉ đêm thứ ba trở đi. Vé in giá từng đêm sau khi đã nhân hệ số.',
    terms: [
      'Giá cuối cùng là giá trên báo giá ở bước chọn phòng; trang này chỉ giải thích cách tính.',
      'Tiền hoàn tính trên số bạn đã thực trả, theo bậc của gói giá tại thời điểm huỷ.',
      'Hoàn tiền được xử lý trong 3 ngày làm việc, tối đa 7 ngày kể từ khi yêu cầu được duyệt.',
      'Giá mỗi đêm luôn nằm trong khoảng sàn và trần của hạng phòng, kể cả sau khi giảm.',
    ],
    seoTitle: 'Giá theo số đêm và bốn gói giá · Pine Hill',
    seoDescription:
      'Ở càng lâu giá mỗi đêm càng thấp: hệ số theo số đêm, bốn gói giá với cọc, đổi ngày và bậc hoàn tiền.',
  },
  gallery: {
    summary:
      'Ảnh của ba ga và năm hạng phòng. Lọc theo ga hoặc theo nhóm; bấm vào ảnh để xem lớn và mở trang của ga hay hạng đó.',
    seoTitle: 'Thư viện ảnh · Pine Hill',
    seoDescription: 'Ảnh ba ga Đà Lạt, Phan Thiết, Vũng Tàu và năm hạng phòng của Pine Hill.',
  },
  illustrative: true,
};

const EN: ChainPagesCopy = {
  gettingHere: {
    summary:
      'The three stations sit on one line from the highlands to the sea, each within a day of Ho Chi Minh City. The tables below list every leg for each station; times are estimates.',
    international: [
      'Fly internationally into Tan Son Nhat airport (Ho Chi Minh City), then continue with the legs for your station.',
      'For Da Lat you can connect to a domestic flight the same day; for Phan Thiet and Vung Tau continue by road, train or fast ferry.',
      'Check visa requirements before you travel on the official portal below.',
    ],
    seoTitle: 'Getting to the three stations · Pine Hill',
    seoDescription:
      'Getting to Da Lat, Phan Thiet and Vung Tau: flights, trains, expressways and fast ferries, estimated times for each leg and notes for international guests.',
  },
  experiences: {
    summary:
      'Each station has its own rhythm. Here are a few things worth doing nearby, matched to the best season; they are not tours and need no booking through Pine Hill.',
    items: {
      'dl-pine-walk': {
        name: 'Early walk in the pine forest',
        body: 'Go before nine, while mist still covers the pine hills. The trail around the property takes about an hour.',
      },
      'dl-lake-ride': {
        name: 'Cycling around the lake',
        body: 'A flat loop around the lake, best at midday in the mild sun. Bikes are for hire around the lake.',
      },
      'dl-wild-sunflowers': {
        name: 'Wild sunflowers and a sea of clouds',
        body: 'At the end of the year wild sunflowers turn the hillsides yellow; clear early mornings often show clouds filling the valley.',
      },
      'pt-dunes': {
        name: 'The dunes at sunrise',
        body: 'Climb before seven, while the sand is still cool. Bring water and shoes for sand.',
      },
      'pt-kitesurf': {
        name: 'Watching kitesurfers',
        body: 'In the windy season the beach fills with kites from noon to late afternoon. Watch from the shore or try a lesson at a school nearby.',
      },
      'pt-fishing-village': {
        name: 'The fishing village in the afternoon',
        body: 'Basket boats come in during the afternoon; walk the shore and watch the village sort the catch.',
      },
      'vt-lighthouse': {
        name: 'The lighthouse at sunset',
        body: 'A steep walk of about 30 minutes. Go in the late afternoon to watch the bay as the sun goes down.',
      },
      'vt-early-swim': {
        name: 'An early swim',
        body: 'Locals are in the sea from five in the morning. The water is calmest and coolest before the sun comes up.',
      },
      'vt-small-mountain': {
        name: 'Walking around Small Mountain',
        body: 'In the cool, breezy dry season the road around the mountain, with sea views, is good for walking or cycling.',
      },
    },
    seoTitle: 'Things to do near the stations · Pine Hill',
    seoDescription:
      'Things worth doing near the Da Lat, Phan Thiet and Vung Tau stations, matched to the best season at each.',
  },
  offers: {
    summary:
      'Pine Hill has no promo codes or standing promotions. Lower prices come from fixed rules: the longer you stay, the less each night costs, and the rate plan you choose sets the deposit, date changes and refunds.',
    losBody:
      'When a rate plan has the length-of-stay discount, the factor applies to every night of the stay, not just from the third night on. The ticket prints each night after the factor is applied.',
    terms: [
      'The final price is the one on the quote when you choose a room; this page only explains how it is worked out.',
      'Refunds are based on what you have actually paid, at the step of your rate plan at the time you cancel.',
      'Refunds are processed within 3 working days, and at most 7 days after the request is approved.',
      'Each night always stays between the floor and ceiling price of the room class, even after a discount.',
    ],
    seoTitle: 'Length-of-stay pricing and four rate plans · Pine Hill',
    seoDescription:
      'The longer you stay, the less each night costs: length-of-stay factors and four rate plans with deposits, date changes and refund steps.',
  },
  gallery: {
    summary:
      'Photos of the three stations and five room classes. Filter by station or by group; select a photo to see it large and open the page of that station or class.',
    seoTitle: 'Photo gallery · Pine Hill',
    seoDescription:
      'Photos of the Pine Hill stations in Da Lat, Phan Thiet and Vung Tau and of the five room classes.',
  },
  illustrative: true,
};

const COPY: Readonly<Record<Locale, ChainPagesCopy>> = {
  vi: VI,
  en: EN,
  'zh-CN': CONTENT_PACKS['zh-CN'].chain,
  ja: CONTENT_PACKS.ja.chain,
  ko: CONTENT_PACKS.ko.chain,
  ru: CONTENT_PACKS.ru.chain,
};

export function chainPagesCopy(locale: Locale): ChainPagesCopy {
  return COPY[locale];
}
