/**
 * Nội dung trang cơ sở (`/stays/[slug]`, "tờ giới thiệu ga") — HB-310.
 *
 * Hai lớp, tách rõ:
 * - `PROPERTY_PAGES`: khoá không đổi theo ngôn ngữ (slug — cũng là khoá khớp cơ sở do API trả, mã ga, ô ảnh, hạng nổi bật).
 * - `COPY[locale]`: câu chữ theo locale. Thông số ga (độ cao, khí hậu, mùa, đường đến) lấy từ
 *   `landingContent(locale).stations` để trang chủ và trang ga nói cùng một câu.
 *
 * Nội dung tả nơi chốn là MINH HOẠ (`illustrative: true`), thay bằng nội dung thật của cơ sở trước khi phát
 * hành công khai. Không có giá, tồn phòng, mốc huỷ, diện tích, tiện nghi hay giải thưởng ở đây.
 */
import type { Locale } from '../i18n/locales';
import { CONTENT_PACKS } from './locale-packs';
import type { RoomTypeCode } from './room-type-pages';

export interface PropertyPageKey {
  readonly slug: string;
  /** Mã ga trên tuyến (khớp `Station.code` của nội dung trang chủ). */
  readonly stationCode: string;
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
    posterPhotoId: 'ga-DL-poster',
    galleryIds: ['ga-DL-poster', 'ga-DL-phong', 'ga-DL-canh', 'hang-DLX'],
    featuredRoomCodes: ['STD', 'SUP', 'DLX', 'FAM', 'DOR'],
  },
  {
    slug: 'phan-thiet',
    stationCode: 'PT',
    posterPhotoId: 'ga-PT-poster',
    galleryIds: ['ga-PT-poster', 'ga-PT-phong', 'ga-PT-canh'],
    featuredRoomCodes: ['STD', 'SUP', 'DLX', 'FAM', 'DOR'],
  },
  {
    slug: 'vung-tau',
    stationCode: 'VT',
    posterPhotoId: 'ga-VT-poster',
    galleryIds: ['ga-VT-poster', 'ga-VT-phong', 'ga-VT-canh'],
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
    'phan-thiet': {
      summary:
        'Ga giữa tuyến, sát biển. Phan Thiết là nắng, gió và đồi cát: sáng sớm lên đồi, trưa tránh nắng, chiều ra biển.',
      story: [
        'Cơ sở nằm gần biển, đủ xa đường lớn để đêm nghe sóng. Từ tháng 11 đến tháng 4 gió thổi mạnh và trời trong; đồi cát đẹp nhất lúc bình minh, trước khi cát nóng lên.',
        'Phan Thiết hợp với vài đêm chậm rãi: một buổi sáng cho đồi cát, một buổi chiều cho làng chài, phần còn lại cho biển. Giá từng đêm in riêng trên vé nên bạn thấy rõ đêm nào là cuối tuần, đêm nào vào mùa gió.',
      ],
      arrival: [
        'Tàu từ ga Sài Gòn đến ga Phan Thiết mất khoảng 4 giờ; từ ga đi tiếp bằng taxi.',
        'Đi đường cao tốc từ TP.HCM mất khoảng 3 giờ.',
        'Đến sớm hơn giờ nhận phòng thì gửi hành lý ở lễ tân; giờ nhận và trả phòng in ở bảng giờ phía trên.',
      ],
      seoTitle: 'Ga Phan Thiết · Pine Hill',
      seoDescription:
        'Cơ sở Pine Hill bên biển Phan Thiết: giờ nhận và trả phòng, đường đến, các hạng phòng và ảnh. Xem giá từng đêm khi chọn ngày.',
      illustrative: true,
    },
    'vung-tau': {
      summary:
        'Ga cuối tuyến, gần thành phố nhất. Vũng Tàu là biển ấm quanh năm, núi Nhỏ và ngọn hải đăng nhìn xuống vịnh.',
      story: [
        'Cơ sở nằm giữa biển và núi Nhỏ, đi bộ được ra bãi. Trời ấm quanh năm; mùa mưa từ tháng 5 đến tháng 10 thường là cơn mưa chiều ngắn rồi tạnh.',
        'Vũng Tàu hợp với cuối tuần ngắn nhưng ngày thường yên hơn hẳn. Đường lên hải đăng dốc, nên đi lúc chiều muộn khi nắng đã dịu. Giá từng đêm in riêng trên vé, nên chênh lệch giữa đêm thứ Sáu và đêm thứ Ba hiện rõ trước khi bạn giữ chỗ.',
      ],
      arrival: [
        'Đi đường cao tốc từ TP.HCM mất khoảng 2 giờ.',
        'Tàu cao tốc từ bến Bạch Đằng đến Vũng Tàu; từ bến đi tiếp bằng taxi.',
        'Đến sớm hơn giờ nhận phòng thì gửi hành lý ở lễ tân; giờ nhận và trả phòng in ở bảng giờ phía trên.',
      ],
      seoTitle: 'Ga Vũng Tàu · Pine Hill',
      seoDescription:
        'Cơ sở Pine Hill ở Vũng Tàu, giữa biển và núi Nhỏ: giờ nhận và trả phòng, đường đến, các hạng phòng và ảnh. Xem giá từng đêm khi chọn ngày.',
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
    'phan-thiet': {
      summary:
        'The middle station on the line, right by the sea. Phan Thiet is sun, wind and sand dunes: up the dunes early, out of the sun at noon, the beach in the afternoon.',
      story: [
        'The property sits near the sea, far enough from the main road to hear the waves at night. From November to April the wind is strong and the sky is clear; the dunes are best at sunrise, before the sand heats up.',
        'Phan Thiet suits a few slow nights: one morning for the dunes, one afternoon for the fishing village, the rest for the sea. Each night is priced on its own leg of the ticket, so you can see which nights are weekends and which fall in the windy season.',
      ],
      arrival: [
        'The train from Saigon station to Phan Thiet station takes about 4 hours; take a taxi from the station.',
        'By expressway from Ho Chi Minh City it takes about 3 hours.',
        'If you arrive before check-in time, leave your luggage at reception; check-in and check-out times are on the timetable above.',
      ],
      seoTitle: 'Phan Thiet Station · Pine Hill',
      seoDescription:
        'The Pine Hill property by the sea in Phan Thiet: check-in and check-out times, getting there, room classes and photos. See nightly prices when you pick dates.',
      illustrative: true,
    },
    'vung-tau': {
      summary:
        'The last station on the line, closest to the city. Vung Tau is warm sea all year, Small Mountain and a lighthouse looking down on the bay.',
      story: [
        'The property sits between the sea and Small Mountain, within walking distance of the beach. It is warm all year; in the rainy season from May to October the rain usually comes as a short afternoon shower.',
        'Vung Tau suits a short weekend, but weekdays are much quieter. The road up to the lighthouse is steep, so go in the late afternoon when the sun is softer. Each night is priced on its own leg, so the difference between a Friday and a Tuesday night shows before you hold.',
      ],
      arrival: [
        'By expressway from Ho Chi Minh City it takes about 2 hours.',
        'Fast ferries run from Bach Dang pier to Vung Tau; take a taxi from the pier.',
        'If you arrive before check-in time, leave your luggage at reception; check-in and check-out times are on the timetable above.',
      ],
      seoTitle: 'Vung Tau Station · Pine Hill',
      seoDescription:
        'The Pine Hill property in Vung Tau, between the sea and Small Mountain: check-in and check-out times, getting there, room classes and photos. See nightly prices when you pick dates.',
      illustrative: true,
    },
  },
  'zh-CN': CONTENT_PACKS['zh-CN'].properties,
  ja: CONTENT_PACKS.ja.properties,
  ko: CONTENT_PACKS.ko.properties,
  ru: CONTENT_PACKS.ru.properties,
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

/** Khớp cơ sở do API trả với trang ga theo `slug` (TD-82, HB-319). */
export function matchPropertyId(
  page: PropertyPageKey,
  properties: readonly { readonly id: string; readonly slug: string }[],
): string | null {
  return properties.find((property) => property.slug === page.slug)?.id ?? null;
}

/** CTA "Xem phòng trống": về khối tìm phòng trang chủ, ga chọn sẵn; không bịa ngày. */
export function searchCtaHref(slug: string | null): string {
  return slug === null ? '/#search-block' : `/?ga=${encodeURIComponent(slug)}#search-block`;
}
