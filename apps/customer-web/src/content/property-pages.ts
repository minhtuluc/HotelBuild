/**
 * Nội dung trang cơ sở (`/stays/[slug]`, "tờ giới thiệu ga") — HB-310.
 *
 * Hai lớp, tách rõ:
 * - `PROPERTY_PAGES`: khoá không đổi theo ngôn ngữ (slug, mã ga, ô ảnh, hạng nổi bật, cách khớp cơ sở API).
 * - `COPY[locale]`: câu chữ theo locale. Thông số ga (độ cao, khí hậu, mùa, đường đến) lấy từ
 *   `landingContent(locale).stations` để trang chủ và trang ga nói cùng một câu.
 *
 * Nội dung tả nơi chốn là MINH HOẠ (`illustrative: true`), thay bằng nội dung thật của cơ sở trước khi phát
 * hành công khai. Không có giá, tồn phòng, mốc huỷ, diện tích, tiện nghi hay giải thưởng ở đây.
 */
import type { Locale } from '../i18n/locales';
import type { RoomTypeCode } from './room-type-pages';

export interface PropertyPageKey {
  readonly slug: string;
  /** Mã ga trên tuyến (khớp `Station.code` của nội dung trang chủ). */
  readonly stationCode: string;
  /**
   * API công khai chỉ trả `id`, `name`, giờ nhận/trả (chưa có slug): khớp cơ sở bằng chuỗi có trong tên.
   * Nợ kỹ thuật: thêm `slug` vào `GET /public/properties` rồi bỏ cách khớp này.
   */
  readonly apiNameIncludes: string;
  readonly posterPhotoId: string;
  /** Ô ảnh của gallery, theo thứ tự hiện (ô chưa có file thì tự ẩn). */
  readonly galleryIds: readonly string[];
  readonly featuredRoomCodes: readonly RoomTypeCode[];
}

export interface PropertyPageCopy {
  readonly summary: string;
  readonly story: readonly string[];
  readonly arrival: readonly string[];
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly illustrative: true;
}

export const PROPERTY_PAGES: readonly PropertyPageKey[] = [
  {
    slug: 'da-lat',
    stationCode: 'DL',
    apiNameIncludes: 'Đà Lạt',
    posterPhotoId: 'ga-DL-poster',
    galleryIds: ['ga-DL-poster', 'ga-DL-phong', 'ga-DL-canh', 'hang-DLX'],
    featuredRoomCodes: ['STD', 'SUP', 'DLX', 'FAM', 'DOR'],
  },
];

const COPY: Readonly<Record<Locale, Readonly<Record<string, PropertyPageCopy>>>> = {
  vi: {
    'da-lat': {
      summary:
        'Ga đầu tuyến, trên cao nguyên. Đến Đà Lạt để chậm lại: sáng sương, trưa nắng nhẹ, tối lạnh đủ để cần áo khoác.',
      story: [
        'Cơ sở nằm giữa đồi thông, cách trung tâm một quãng đủ yên để nghe gió. Buổi sáng sương phủ thấp rồi tan dần trước chín giờ; buổi tối nhiệt độ xuống nhanh, ai đi từ đồng bằng lên nên mang theo một lớp áo ấm.',
        'Đà Lạt hợp với kỳ nghỉ vài đêm: đêm đầu nghỉ chân sau chặng đường, những ngày sau đi bộ, đạp xe quanh hồ hoặc ngồi yên một chỗ. Giá từng đêm in riêng trên vé nên bạn thấy rõ đêm nào là cuối tuần, đêm nào là mùa cao điểm.',
      ],
      arrival: [
        'Bay đến sân bay Liên Khương rồi đi tiếp khoảng 30 km bằng taxi hoặc xe đưa đón của sân bay.',
        'Xe khách giường nằm từ TP.HCM mất khoảng 7 giờ; nhiều chuyến chạy đêm, đến nơi lúc sáng sớm, trước giờ nhận phòng.',
        'Đến sớm hơn giờ nhận phòng thì gửi hành lý ở lễ tân; giờ nhận và trả phòng in ở bảng giờ phía trên.',
      ],
      seoTitle: 'Ga Đà Lạt · Pine Hill',
      seoDescription:
        'Cơ sở Pine Hill trên cao nguyên Đà Lạt: giờ nhận và trả phòng, đường đến, các hạng phòng và ảnh. Xem giá từng đêm khi chọn ngày.',
      illustrative: true,
    },
  },
  en: {
    'da-lat': {
      summary:
        'The first station on the line, up in the highlands. Come to Da Lat to slow down: misty mornings, mild sun at noon, evenings cool enough for a jacket.',
      story: [
        'The property sits among pine hills, far enough from the centre to hear the wind. Morning mist hangs low and lifts before nine; in the evening the temperature drops quickly, so bring a warm layer if you are coming up from the lowlands.',
        'Da Lat suits a stay of a few nights: rest after the journey on the first night, then walk, cycle around the lake or simply stay put. Each night is priced on its own leg of the ticket, so you can see which nights are weekends and which fall in high season.',
      ],
      arrival: [
        'Fly to Lien Khuong airport, then about 30 km by taxi or airport shuttle.',
        'Sleeper coaches from Ho Chi Minh City take about 7 hours; many run overnight and arrive early in the morning, before check-in time.',
        'If you arrive before check-in time, leave your luggage at reception; check-in and check-out times are on the timetable above.',
      ],
      seoTitle: 'Da Lat Station · Pine Hill',
      seoDescription:
        'The Pine Hill property in the Da Lat highlands: check-in and check-out times, getting there, room classes and photos. See nightly prices when you pick dates.',
      illustrative: true,
    },
  },
};

export function propertyPageKey(slug: string): PropertyPageKey | undefined {
  return PROPERTY_PAGES.find((page) => page.slug === slug);
}

/** Trang ga có cho mã ga này (để trang chủ biết có link "Đọc thêm" hay không). */
export function propertyPageByStation(stationCode: string): PropertyPageKey | undefined {
  return PROPERTY_PAGES.find((page) => page.stationCode === stationCode);
}

export function propertyPageCopy(slug: string, locale: Locale): PropertyPageCopy | undefined {
  return COPY[locale][slug];
}

/** Khớp cơ sở do API trả với trang ga (xem `apiNameIncludes`). */
export function matchPropertyId(
  page: PropertyPageKey,
  properties: readonly { readonly id: string; readonly name: string }[],
): string | null {
  return properties.find((property) => property.name.includes(page.apiNameIncludes))?.id ?? null;
}

/** CTA "Xem phòng trống": về khối tìm phòng trang chủ, ga chọn sẵn; không bịa ngày. */
export function searchCtaHref(slug: string | null): string {
  return slug === null ? '/#search-block' : `/?ga=${encodeURIComponent(slug)}#search-block`;
}
