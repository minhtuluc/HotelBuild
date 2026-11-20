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
import type { Locale } from '@pinehill/i18n';
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
  /**
   * Tháng (1–12) của bốn mùa trong lịch mùa (HB-322, FEAT-02), cùng thứ tự với `PropertyPageCopy.seasons`.
   * Phủ đủ 12 tháng, không trùng. Không phải mùa giá (Q14).
   */
  readonly seasonMonths: readonly (readonly number[])[];
}

/** Một chặng đến ga (UX-05): thời gian là ước lượng, không ghi mã chuyến hay giờ chạy. */
export interface ArrivalLeg {
  readonly time: string;
  readonly route: string;
}

/** Một mùa của lịch mùa: thời tiết minh hoạ, không nhãn giá. */
export interface SeasonCopy {
  readonly name: string;
  readonly weather: string;
  readonly tip: string;
}

export interface PropertyPageCopy {
  readonly summary: string;
  readonly story: readonly string[];
  /** Bảng chặng đến ga (HB-322, UX-05). */
  readonly legs: readonly ArrivalLeg[];
  /** Dòng dưới bảng chặng (gửi hành lý khi đến sớm). */
  readonly arrivalNote: string;
  /** "Một ngày tại ga": sáng sớm, giữa ngày, chiều tối (HB-322, CONT-02). */
  readonly day: readonly [string, string, string];
  /** Bốn mùa, cùng thứ tự với `PropertyPageKey.seasonMonths`. */
  readonly seasons: readonly [SeasonCopy, SeasonCopy, SeasonCopy, SeasonCopy];
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
    seasonMonths: [
      [11, 12],
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9, 10],
    ],
  },
  {
    slug: 'phan-thiet',
    stationCode: 'PT',
    posterPhotoId: 'ga-PT-poster',
    galleryIds: ['ga-PT-poster', 'ga-PT-phong', 'ga-PT-canh'],
    featuredRoomCodes: ['STD', 'SUP', 'DLX', 'FAM', 'DOR'],
    seasonMonths: [
      [11, 12, 1],
      [2, 3, 4],
      [5, 6, 7],
      [8, 9, 10],
    ],
  },
  {
    slug: 'vung-tau',
    stationCode: 'VT',
    posterPhotoId: 'ga-VT-poster',
    galleryIds: ['ga-VT-poster', 'ga-VT-phong', 'ga-VT-canh'],
    featuredRoomCodes: ['STD', 'SUP', 'DLX', 'FAM', 'DOR'],
    seasonMonths: [
      [11, 12, 1],
      [2, 3, 4],
      [5, 6, 7],
      [8, 9, 10],
    ],
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
      legs: [
        {
          time: '≈ 50 phút bay + 45 phút xe',
          route:
            'Bay từ TP.HCM đến sân bay Liên Khương, rồi khoảng 30 km bằng taxi hoặc xe đưa đón của sân bay.',
        },
        {
          time: '≈ 7 giờ',
          route:
            'Xe khách giường nằm từ TP.HCM; nhiều chuyến chạy đêm, đến nơi lúc sáng sớm, trước giờ nhận phòng.',
        },
      ],
      arrivalNote:
        'Thời gian đi đường là ước lượng. Đến sớm hơn giờ nhận phòng thì gửi hành lý ở lễ tân; giờ nhận và trả phòng in ở bảng giờ phía trên.',
      day: [
        'Sương phủ thấp trên đồi thông rồi tan dần trước chín giờ. Hợp để đi bộ một vòng quanh đồi khi trời còn lạnh.',
        'Nắng nhẹ, trời trong. Lúc dạo quanh hồ, đạp xe hoặc vào phố chợ.',
        'Sau hoàng hôn nhiệt độ xuống nhanh. Mặc thêm áo ấm nếu ra chợ đêm, hoặc về khoang nghỉ sớm.',
      ],
      seasons: [
        {
          name: 'Mây và dã quỳ',
          weather: 'Ngày ≈ 20–23 °C, đêm ≈ 13–15 °C · mưa thưa dần',
          tip: 'Dã quỳ nở vàng ven đồi; sáng sớm hay có biển mây.',
        },
        {
          name: 'Mùa khô',
          weather: 'Ngày ≈ 21–24 °C, đêm ≈ 11–14 °C · ít mưa',
          tip: 'Trời trong, đêm lạnh nhất năm; mai anh đào nở quanh tháng 1, tháng 2.',
        },
        {
          name: 'Chuyển mùa',
          weather: 'Ngày ≈ 23–25 °C, đêm ≈ 15–17 °C · mưa chiều từ tháng 5',
          tip: 'Ấm nhất năm; đi chơi buổi sáng, chiều mang theo áo mưa.',
        },
        {
          name: 'Mưa và sương',
          weather: 'Ngày ≈ 20–23 °C, đêm ≈ 15–16 °C · mưa chiều gần như mỗi ngày',
          tip: 'Rừng thông xanh và vắng khách; xếp việc ngoài trời vào buổi sáng.',
        },
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
      legs: [
        { time: '≈ 4 giờ', route: 'Tàu từ ga Sài Gòn đến ga Phan Thiết, rồi đi tiếp bằng taxi.' },
        { time: '≈ 3 giờ', route: 'Ô tô theo đường cao tốc từ TP.HCM.' },
      ],
      arrivalNote:
        'Thời gian đi đường là ước lượng. Đến sớm hơn giờ nhận phòng thì gửi hành lý ở lễ tân; giờ nhận và trả phòng in ở bảng giờ phía trên.',
      day: [
        'Lên đồi cát lúc bình minh, khi cát còn mát và gió chưa mạnh.',
        'Nắng gắt nhất ngày. Nghỉ trong khoang, rồi ra làng chài khi đã quá trưa.',
        'Gió dịu, biển đổi màu theo hoàng hôn. Đi dọc bãi trước bữa tối.',
      ],
      seasons: [
        {
          name: 'Gió đầu mùa',
          weather: 'Ngày ≈ 29–31 °C, đêm ≈ 23–24 °C · hết mưa, gió mạnh dần',
          tip: 'Trời trong, biển còn sóng; hợp ngắm đồi cát và xem lướt ván diều.',
        },
        {
          name: 'Nắng khô',
          weather: 'Ngày ≈ 31–33 °C, đêm ≈ 24–25 °C · gần như không mưa',
          tip: 'Đồi cát đẹp nhất năm; gió nhẹ dần về cuối tháng 4.',
        },
        {
          name: 'Biển êm',
          weather: 'Ngày ≈ 31–32 °C, đêm ≈ 25–26 °C · mưa chiều ngắn',
          tip: 'Sóng lặng, nước trong; tắm biển buổi sáng.',
        },
        {
          name: 'Mưa chiều',
          weather: 'Ngày ≈ 29–31 °C, đêm ≈ 24–25 °C · mưa nhiều nhất năm',
          tip: 'Vắng khách; đi chơi buổi sáng, chiều nghỉ ngơi.',
        },
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
      legs: [
        { time: '≈ 2 giờ', route: 'Ô tô theo đường cao tốc từ TP.HCM.' },
        {
          time: '≈ 1 giờ 30',
          route: 'Tàu cao tốc từ bến Bạch Đằng đến Vũng Tàu, rồi đi tiếp bằng taxi.',
        },
      ],
      arrivalNote:
        'Thời gian đi đường là ước lượng. Đến sớm hơn giờ nhận phòng thì gửi hành lý ở lễ tân; giờ nhận và trả phòng in ở bảng giờ phía trên.',
      day: [
        'Bãi biển còn mát, người địa phương tắm biển từ rất sớm. Đi bộ dọc bờ trước khi nắng lên.',
        'Nắng ấm. Nghỉ trong khoang hoặc dạo phố biển dưới bóng cây.',
        'Leo dốc lên hải đăng lúc chiều muộn, nhìn vịnh lúc hoàng hôn rồi xuống ăn tối.',
      ],
      seasons: [
        {
          name: 'Khô và gió',
          weather: 'Ngày ≈ 29–30 °C, đêm ≈ 23–24 °C · ít mưa',
          tip: 'Gió mát, trời trong; hợp đi bộ lên núi Nhỏ.',
        },
        {
          name: 'Nắng nóng',
          weather: 'Ngày ≈ 31–33 °C, đêm ≈ 25–26 °C · gần như không mưa',
          tip: 'Biển ấm, nắng mạnh; ra bãi lúc sáng sớm hoặc chiều muộn.',
        },
        {
          name: 'Đầu mùa mưa',
          weather: 'Ngày ≈ 31–32 °C, đêm ≈ 25–26 °C · mưa chiều ngắn',
          tip: 'Mưa nhanh rồi tạnh; ngày thường rất vắng.',
        },
        {
          name: 'Mưa chiều',
          weather: 'Ngày ≈ 29–31 °C, đêm ≈ 24–25 °C · mưa nhiều nhất năm',
          tip: 'Đi chơi buổi sáng; chiều mang theo áo mưa.',
        },
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
      legs: [
        {
          time: '≈ 50 min flight + 45 min drive',
          route:
            'Fly from Ho Chi Minh City to Lien Khuong airport, then about 30 km by taxi or airport shuttle.',
        },
        {
          time: '≈ 7 hours',
          route:
            'Sleeper coach from Ho Chi Minh City; many run overnight and arrive early in the morning, before check-in time.',
        },
      ],
      arrivalNote:
        'Travel times are estimates. If you arrive before check-in time, leave your luggage at reception; check-in and check-out times are on the timetable above.',
      day: [
        'Mist hangs low over the pine hills and lifts before nine. A good time to walk the hills while the air is still cold.',
        'Mild sun and clear skies. Time to stroll around the lake, cycle or head into the market streets.',
        'The temperature drops quickly after sunset. Add a warm layer for the night market, or turn in early.',
      ],
      seasons: [
        {
          name: 'Clouds and wild sunflowers',
          weather: 'Day ≈ 20–23 °C, night ≈ 13–15 °C · rain tapering off',
          tip: 'Wild sunflowers turn the hillsides yellow; early mornings often bring a sea of clouds.',
        },
        {
          name: 'Dry season',
          weather: 'Day ≈ 21–24 °C, night ≈ 11–14 °C · little rain',
          tip: 'Clear skies and the coldest nights of the year; cherry blossoms around January and February.',
        },
        {
          name: 'Between seasons',
          weather: 'Day ≈ 23–25 °C, night ≈ 15–17 °C · afternoon rain from May',
          tip: 'The warmest months; go out in the morning and carry a raincoat in the afternoon.',
        },
        {
          name: 'Rain and mist',
          weather: 'Day ≈ 20–23 °C, night ≈ 15–16 °C · afternoon rain most days',
          tip: 'Green pine forests and few visitors; plan time outdoors for the morning.',
        },
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
      legs: [
        {
          time: '≈ 4 hours',
          route: 'Train from Saigon station to Phan Thiet station, then a taxi.',
        },
        { time: '≈ 3 hours', route: 'By car on the expressway from Ho Chi Minh City.' },
      ],
      arrivalNote:
        'Travel times are estimates. If you arrive before check-in time, leave your luggage at reception; check-in and check-out times are on the timetable above.',
      day: [
        'Climb the dunes at sunrise, while the sand is still cool and the wind is light.',
        'The strongest sun of the day. Rest in your cabin, then visit the fishing village after midday.',
        'The wind softens and the sea changes colour with the sunset. Walk the beach before dinner.',
      ],
      seasons: [
        {
          name: 'Early windy season',
          weather: 'Day ≈ 29–31 °C, night ≈ 23–24 °C · rain ends, wind picks up',
          tip: 'Clear skies and lively waves; good for the dunes and watching kitesurfers.',
        },
        {
          name: 'Dry and sunny',
          weather: 'Day ≈ 31–33 °C, night ≈ 24–25 °C · almost no rain',
          tip: 'The best time for the dunes; the wind eases towards the end of April.',
        },
        {
          name: 'Calm sea',
          weather: 'Day ≈ 31–32 °C, night ≈ 25–26 °C · short afternoon showers',
          tip: 'Flat water and clear sea; swim in the morning.',
        },
        {
          name: 'Afternoon rain',
          weather: 'Day ≈ 29–31 °C, night ≈ 24–25 °C · the wettest months',
          tip: 'Few visitors; go out in the morning and rest in the afternoon.',
        },
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
      legs: [
        { time: '≈ 2 hours', route: 'By car on the expressway from Ho Chi Minh City.' },
        { time: '≈ 1 hour 30', route: 'Fast ferry from Bach Dang pier to Vung Tau, then a taxi.' },
      ],
      arrivalNote:
        'Travel times are estimates. If you arrive before check-in time, leave your luggage at reception; check-in and check-out times are on the timetable above.',
      day: [
        'The beach is still cool and locals swim very early. Walk the shore before the sun comes up.',
        'Warm sun. Rest in your cabin or stroll the seafront in the shade of the trees.',
        'Climb to the lighthouse in the late afternoon, watch the bay at sunset, then come down for dinner.',
      ],
      seasons: [
        {
          name: 'Dry and breezy',
          weather: 'Day ≈ 29–30 °C, night ≈ 23–24 °C · little rain',
          tip: 'Cool wind and clear skies; good for walking up Small Mountain.',
        },
        {
          name: 'Hot and sunny',
          weather: 'Day ≈ 31–33 °C, night ≈ 25–26 °C · almost no rain',
          tip: 'Warm sea and strong sun; go to the beach early or late in the day.',
        },
        {
          name: 'Early rainy season',
          weather: 'Day ≈ 31–32 °C, night ≈ 25–26 °C · short afternoon showers',
          tip: 'Rain comes and goes quickly; weekdays are very quiet.',
        },
        {
          name: 'Afternoon rain',
          weather: 'Day ≈ 29–31 °C, night ≈ 24–25 °C · the wettest months',
          tip: 'Go out in the morning; carry a raincoat in the afternoon.',
        },
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
