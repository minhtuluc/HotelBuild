/**
 * Nội dung tĩnh của trang chủ khách ("tuyến Pine Hill").
 *
 * Hai loại nội dung, tách rõ:
 * 1. MINH HOẠ — do người dựng giao diện viết để trang có chất liệu (mô tả nơi chốn, mẹo đường đi, lời ga).
 *    THAY bằng nội dung thật của từng cơ sở trước khi phát hành. Đánh dấu `illustrative: true`.
 * 2. CHÍNH SÁCH — chép từ docs/02-nghiep-vu/chinh-sach-huy-hoan-coc.md và docs/02-nghiep-vu/quy-tac-nghiep-vu.md.
 *    Chỉ để giải thích; số tiền áp cho một đơn cụ thể luôn do máy chủ tính và in trên báo giá.
 *    Đổi chính sách thì phải sửa file này cùng lúc.
 *
 * Không có giá bán, đánh giá hay số liệu kinh doanh nào ở đây.
 */
import type { Locale } from '../i18n/locales';
import { LANDING_EN } from './landing-content-en';

export interface Station {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly altitude: string;
  readonly climate: string;
  readonly bestMonths: string;
  readonly getThere: string;
  readonly note: string;
  readonly illustrative: true;
}

/** Ba ga trên tuyến: tên địa phương theo dữ liệu seed (docs/00 §1: 3 cơ sở). */
const STATIONS: readonly Station[] = [
  {
    code: 'DL',
    name: 'Đà Lạt',
    kind: 'Cao nguyên, đồi thông',
    altitude: '≈ 1.500 m',
    climate: 'Mát quanh năm, đêm có thể xuống dưới 15 °C',
    bestMonths: 'Tháng 11 đến tháng 3, mùa khô',
    getThere: 'Sân bay Liên Khương khoảng 30 km; xe khách từ TP.HCM khoảng 7 giờ',
    note: 'Mang áo khoác cho buổi tối. Sương thường tan trước 9 giờ sáng.',
    illustrative: true,
  },
  {
    code: 'PT',
    name: 'Phan Thiết',
    kind: 'Biển, đồi cát',
    altitude: 'Ngang mặt biển',
    climate: 'Nắng, gió mạnh từ tháng 11 đến tháng 4',
    bestMonths: 'Tháng 12 đến tháng 4, mùa gió và nắng',
    getThere: 'Tàu hoả từ ga Sài Gòn tới ga Phan Thiết khoảng 4 giờ; cao tốc khoảng 3 giờ',
    note: 'Đồi cát đẹp nhất lúc bình minh, trước khi cát nóng.',
    illustrative: true,
  },
  {
    code: 'VT',
    name: 'Vũng Tàu',
    kind: 'Biển, núi Nhỏ, hải đăng',
    altitude: 'Ngang mặt biển',
    climate: 'Ấm quanh năm, mùa mưa tháng 5 đến tháng 10',
    bestMonths: 'Quanh năm; ngày thường vắng hơn cuối tuần',
    getThere: 'Cao tốc từ TP.HCM khoảng 2 giờ; tàu cao tốc từ bến Bạch Đằng',
    note: 'Đường lên hải đăng dốc, nên đi buổi chiều muộn.',
    illustrative: true,
  },
] as const;

export interface CabinClass {
  readonly code: string;
  readonly name: string;
  readonly cabin: string;
  readonly capacity: string;
  readonly detail: string;
}

/** Hạng phòng theo seed (apps/api/prisma/seed/reference-data.ts); giá luôn đọc từ báo giá. */
const CABIN_CLASSES: readonly CabinClass[] = [
  {
    code: 'STD',
    name: 'Standard',
    cabin: 'Khoang đôi',
    capacity: '2 người lớn',
    detail: 'Phòng gọn cho hai người, đủ cho chuyến ngắn ngày.',
  },
  {
    code: 'SUP',
    name: 'Superior',
    cabin: 'Khoang đôi rộng',
    capacity: '2 người lớn',
    detail: 'Rộng hơn Standard, hợp kỳ ở dài hơn hai đêm.',
  },
  {
    code: 'DLX',
    name: 'Deluxe',
    cabin: 'Khoang ba',
    capacity: '3 người lớn',
    detail: 'Thêm chỗ cho người thứ ba mà không cần phòng thứ hai.',
  },
  {
    code: 'FAM',
    name: 'Family',
    cabin: 'Khoang bốn',
    capacity: '4 người lớn',
    detail: 'Cho gia đình hoặc nhóm bốn người ở chung.',
  },
  {
    code: 'DOR',
    name: 'Dorm',
    cabin: 'Khoang sáu, bán theo giường',
    capacity: '1 giường / người',
    detail: 'Đi một mình hoặc nhóm nhỏ: đặt từng giường trong phòng 6 giường.',
  },
] as const;

/** Thứ tự hệ số khi tính giá một đêm (docs/00 §2, BT-2). */
const FARE_FACTORS: readonly { readonly label: string; readonly hint: string }[] = [
  { label: 'Giá hạng phòng', hint: 'giá gốc của hạng bạn chọn' },
  { label: '× mùa', hint: 'mùa thấp rẻ hơn, mùa hè và lễ Tết cao hơn' },
  { label: '× cuối tuần', hint: 'đêm thứ Sáu và thứ Bảy' },
  { label: '× công suất', hint: 'khi cơ sở gần kín phòng' },
  { label: '× độ dài kỳ ở', hint: 'ở từ 3 đêm, từ 14 đêm được giảm' },
  { label: '× kênh', hint: 'đặt trực tiếp trên web dùng hệ số của kênh web' },
] as const;

export interface SampleNight {
  readonly date: string;
  readonly weekday: string;
  readonly amount: number;
  readonly why: string;
}

/**
 * Vé mẫu BK-A trong docs/02-nghiep-vu/chinh-sach-huy-hoan-coc.md §3.3: Deluxe, nhận phòng thứ Sáu 11/12/2026,
 * 3 đêm, mùa thấp, có giảm ở từ 3 đêm. Đây là ví dụ trong tài liệu, không phải giá đang bán.
 */
const SAMPLE_TICKET = {
  room: 'Deluxe (DLX)',
  checkIn: '11/12/2026',
  checkOut: '14/12/2026',
  nights: [
    { date: '11/12', weekday: 'T6', amount: 1_066_000, why: 'mùa thấp × cuối tuần × ở 3 đêm' },
    { date: '12/12', weekday: 'T7', amount: 1_066_000, why: 'mùa thấp × cuối tuần × ở 3 đêm' },
    { date: '13/12', weekday: 'CN', amount: 889_000, why: 'mùa thấp × ở 3 đêm' },
  ] satisfies readonly SampleNight[],
  total: 3_021_000,
} as const;

export interface RefundStep {
  /** Mốc tính bằng giờ trước giờ nhận phòng; `null` là bậc cuối áp cho mọi trường hợp còn lại. */
  readonly fromHours: number | null;
  readonly label: string;
  readonly refundPercent: number;
  readonly firstNightCharge: boolean;
}

export interface FarePlan {
  readonly code: string;
  readonly name: string;
  readonly deposit: string;
  readonly steps: readonly RefundStep[];
}

/** Bốn gói giá và bậc hoàn (docs/02 §3, bảng CP-*). Hoàn tính trên số tiền đã thực trả. */
const FARE_PLANS: readonly FarePlan[] = [
  {
    code: 'FLEX7',
    name: 'Linh hoạt',
    deposit: 'Cọc 30%',
    steps: [
      { fromHours: 168, label: 'Từ 7 ngày trước', refundPercent: 100, firstNightCharge: false },
      { fromHours: 72, label: '3 đến 7 ngày', refundPercent: 50, firstNightCharge: false },
      { fromHours: 24, label: '1 đến 3 ngày', refundPercent: 0, firstNightCharge: false },
      { fromHours: null, label: 'Dưới 24 giờ', refundPercent: 0, firstNightCharge: true },
    ],
  },
  {
    code: 'SAVER3',
    name: 'Tiết kiệm',
    deposit: 'Cọc 50%',
    steps: [
      { fromHours: 72, label: 'Từ 3 ngày trước', refundPercent: 100, firstNightCharge: false },
      { fromHours: 24, label: '1 đến 3 ngày', refundPercent: 50, firstNightCharge: false },
      { fromHours: null, label: 'Dưới 24 giờ', refundPercent: 0, firstNightCharge: true },
    ],
  },
  {
    code: 'LONGSTAY14',
    name: 'Ở dài',
    deposit: 'Cọc 30%',
    steps: [
      { fromHours: 336, label: 'Từ 14 ngày trước', refundPercent: 100, firstNightCharge: false },
      { fromHours: 168, label: '7 đến 14 ngày', refundPercent: 50, firstNightCharge: false },
      { fromHours: null, label: 'Dưới 7 ngày', refundPercent: 0, firstNightCharge: true },
    ],
  },
  {
    code: 'NONREF',
    name: 'Không hoàn',
    deposit: 'Trả 100%',
    steps: [{ fromHours: null, label: 'Mọi thời điểm', refundPercent: 0, firstNightCharge: false }],
  },
] as const;

/** Bốn bước đặt phòng (UC-BOOK-01, BR-BOOK-07, BR-PAY-05). */
const BOOKING_STEPS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: 'Chọn ga và ngày',
    body: 'Chọn cơ sở, ngày nhận, ngày trả và số khách. Chỉ hiện hạng phòng còn trống cho cả kỳ.',
  },
  {
    title: 'Xem giá từng chặng',
    body: 'Mỗi đêm một dòng giá. Chọn gói giá để thấy tiền cọc và các mốc hoàn khi huỷ.',
  },
  {
    title: 'Giữ chỗ 10 phút',
    body: 'Phòng được giữ riêng cho bạn trong 10 phút, có đồng hồ đếm ngược trên màn hình.',
  },
  {
    title: 'Đặt cọc, nhận vé',
    body: 'Trả cọc qua VNPay hoặc MoMo. Nhận mã đặt phòng dạng PH-…, tra cứu lại bất cứ lúc nào.',
  },
] as const;

/** Hỏi đáp: mỗi câu trả lời dựa trên một quy tắc nghiệp vụ đã ghi ở docs/02. */
const FAQ: readonly { readonly q: string; readonly a: string }[] = [
  {
    q: 'Mốc huỷ tính từ lúc nào?',
    a: 'Tính bằng số giờ trước giờ nhận phòng của cơ sở (thường 14:00, giờ Việt Nam), không tính theo ngày. Huỷ lúc 9 giờ sáng ngày nhận phòng là dưới 24 giờ.',
  },
  {
    q: 'Tiền hoàn tính trên số nào?',
    a: 'Trên số tiền bạn đã thực trả, không phải trên tổng giá trị đặt phòng.',
  },
  {
    q: 'Thiên tai, dịch bệnh thì sao?',
    a: 'Huỷ vì bất khả kháng được hoàn 100% số đã trả.',
  },
  {
    q: 'Đổi ngày có mất phí không?',
    a: 'Đổi ngày một lần được miễn phí nếu còn từ 7 ngày trở lên trước ngày nhận phòng. Gói Không hoàn chịu phí 10%.',
  },
  {
    q: 'Nếu cơ sở hết phòng sau khi tôi đã đặt?',
    a: 'Bạn được chuyển sang phòng cùng hạng hoặc được nâng hạng miễn phí và giữ nguyên giá đã đặt. Nếu không còn cách nào, bạn được hoàn 100% kèm bồi thường.',
  },
] as const;

export interface SampleTicket {
  readonly room: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: readonly SampleNight[];
  readonly total: number;
}

/** Toàn bộ nội dung tĩnh trang chủ của một locale. */
export interface LandingContent {
  readonly stations: readonly Station[];
  readonly cabinClasses: readonly CabinClass[];
  readonly fareFactors: readonly { readonly label: string; readonly hint: string }[];
  readonly sampleTicket: SampleTicket;
  readonly farePlans: readonly FarePlan[];
  readonly bookingSteps: readonly { readonly title: string; readonly body: string }[];
  readonly faq: readonly { readonly q: string; readonly a: string }[];
}

const LANDING: Readonly<Record<Locale, LandingContent>> = {
  vi: {
    stations: STATIONS,
    cabinClasses: CABIN_CLASSES,
    fareFactors: FARE_FACTORS,
    sampleTicket: SAMPLE_TICKET,
    farePlans: FARE_PLANS,
    bookingSteps: BOOKING_STEPS,
    faq: FAQ,
  },
  en: LANDING_EN,
};

/** Nội dung tĩnh trang chủ theo locale (HB-309). Locale mới phải đủ mọi phần. */
export function landingContent(locale: Locale): LandingContent {
  return LANDING[locale];
}
