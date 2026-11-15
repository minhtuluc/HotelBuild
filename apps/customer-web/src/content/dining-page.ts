/**
 * Trang ẩm thực (`/dining`) và khối "Giá đã gồm" — HB-318.
 *
 * Hai lớp, như trang ga:
 * - Khoá không đổi theo ngôn ngữ: mã nhịp, khung giờ, trạng thái (đã gồm / gọi riêng / không phục vụ).
 *   Trạng thái theo điều khoản `docs/02-nghiep-vu/tien-nghi-trong-gia.md` (ĐK-TN): trà, cà phê ở sảnh đã gồm
 *   (TN-06); ăn uống khác chưa gồm (KG-01).
 * - Câu chữ theo locale: `COPY[locale]` cho `vi`/`en`, gói nội dung (`locale-packs/`) cho locale thêm sau.
 *
 * Giờ phục vụ, món và quán quanh ga là MINH HOẠ (`illustrative: true`): thay bằng thông tin thật của từng cơ
 * sở trước khi phát hành công khai. Không có giá món: khoản gọi riêng trả tại quầy, ngoài hệ thống đặt phòng.
 */
import type { Locale } from '../i18n/locales';
import { CONTENT_PACKS } from './locale-packs';

export type DiningServiceId = 'breakfast' | 'tea' | 'evening';
export type DiningStatus = 'included' | 'extra' | 'none';

export interface DiningServiceKey {
  readonly id: DiningServiceId;
  /** Khung giờ VN, 24 giờ. */
  readonly hours: string;
  readonly status: DiningStatus;
}

export const DINING_SERVICES: readonly DiningServiceKey[] = [
  { id: 'breakfast', hours: '06:30–10:00', status: 'extra' },
  { id: 'tea', hours: '06:00–22:00', status: 'included' },
  { id: 'evening', hours: '17:00–22:00', status: 'none' },
];

export interface DiningPageCopy {
  readonly summary: string;
  readonly services: Readonly<
    Record<DiningServiceId, { readonly name: string; readonly body: string }>
  >;
  readonly nearbyLede: string;
  /** Gợi ý quanh ga theo mã ga (`DL`, `PT`, `VT`). */
  readonly nearby: Readonly<Record<string, readonly string[]>>;
  readonly notes: readonly string[];
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly illustrative: true;
}

/** Câu chữ của khối "Giá đã gồm" (ĐK-TN-01..03), đúng thứ tự và số mục của điều khoản. */
export interface IncludedCopy {
  /** TN-01..06, mọi hạng. */
  readonly included: readonly string[];
  /** TN-07..08, thêm cho Dorm. */
  readonly dorm: readonly string[];
  /** KG-01..04. */
  readonly excluded: readonly string[];
}

const VI_DINING: DiningPageCopy = {
  summary:
    'Pine Hill không có nhà hàng: mỗi ga có một quầy ăn sáng nhỏ và góc trà ở sảnh. Bữa tối thì đi bộ ra quanh ga, nơi có quán của người địa phương.',
  services: {
    breakfast: {
      name: 'Bữa sáng ở quầy ga',
      body: 'Bánh mì, xôi, phở hoặc cháo tuỳ ngày, cà phê phin và trà nóng. Gọi tại quầy, trả riêng; báo lễ tân tối hôm trước nếu đi sớm hơn giờ mở quầy.',
    },
    tea: {
      name: 'Góc trà ở sảnh',
      body: 'Trà và cà phê tự phục vụ cả ngày, đã gồm trong giá phòng. Ở Đà Lạt có thêm ấm trà gừng nóng buổi tối.',
    },
    evening: {
      name: 'Bữa tối quanh ga',
      body: 'Ga không nấu bữa tối. Lễ tân có bản đồ giấy các quán đi bộ được, giờ mở cửa và món nên thử.',
    },
  },
  nearbyLede:
    'Gợi ý trong khoảng 5–15 phút đi bộ hoặc một chặng xe ngắn. Quán do bên ngoài kinh doanh, Pine Hill không nhận đặt chỗ hộ.',
  nearby: {
    DL: [
      'Chợ đêm trung tâm: bánh tráng nướng, sữa đậu nành nóng, xiên nướng.',
      'Quán lẩu gà lá é và bánh căn dọc các con dốc quanh hồ.',
    ],
    PT: [
      'Hải sản nướng ở các quán ven biển, chọn tại bể và trả theo cân.',
      'Bánh xèo, bánh căn và gỏi cá mai ở khu chợ đêm.',
    ],
    VT: [
      'Bánh khọt và lẩu cá đuối ở các quán gần bãi Sau.',
      'Quán cà phê nhìn ra biển dọc đường lên hải đăng.',
    ],
  },
  notes: [
    'Ăn chay hoặc dị ứng thực phẩm: báo lễ tân trước một ngày để quầy sáng chuẩn bị.',
    'Nhóm từ 4 người (hạng Family) muốn ăn sáng cùng giờ: báo trước để quầy giữ bàn.',
    'Mang đồ ăn về phòng được; Dorm xin dùng khu chung để giữ yên cho người cùng phòng.',
  ],
  seoTitle: 'Ăn uống ở ga · Pine Hill',
  seoDescription:
    'Quầy ăn sáng, góc trà ở sảnh và gợi ý quán quanh ba ga Pine Hill: giờ phục vụ, thứ đã gồm trong giá phòng và thứ gọi riêng.',
  illustrative: true,
};

const EN_DINING: DiningPageCopy = {
  summary:
    'Pine Hill has no restaurant: each station has a small breakfast counter and a tea corner in the lobby. For dinner, walk out around the station to local places.',
  services: {
    breakfast: {
      name: 'Breakfast at the station counter',
      body: 'Banh mi, sticky rice, pho or rice porridge depending on the day, Vietnamese drip coffee and hot tea. Order at the counter and pay separately; tell reception the night before if you leave before it opens.',
    },
    tea: {
      name: 'Tea corner in the lobby',
      body: 'Self-service tea and coffee all day, included in the room price. Da Lat adds a pot of hot ginger tea in the evening.',
    },
    evening: {
      name: 'Dinner around the station',
      body: 'The station does not cook dinner. Reception has a paper map of places within walking distance, with opening hours and dishes to try.',
    },
  },
  nearbyLede:
    'Suggestions within a 5–15 minute walk or a short ride. These places are run by others; Pine Hill does not book tables for them.',
  nearby: {
    DL: [
      'The central night market: grilled rice paper, hot soy milk, skewers.',
      'Chicken hotpot with e leaves and banh can on the slopes around the lake.',
    ],
    PT: [
      'Grilled seafood at beachside places, chosen from the tank and paid by weight.',
      'Banh xeo, banh can and raw fish salad at the night market.',
    ],
    VT: [
      'Banh khot and stingray hotpot near Back Beach.',
      'Sea-view cafés along the road up to the lighthouse.',
    ],
  },
  notes: [
    'Vegetarian or food allergies: tell reception a day ahead so the breakfast counter can prepare.',
    'Groups of 4 (Family class) who want breakfast together: tell us ahead so the counter keeps a table.',
    'You can bring food back to your room; in the Dorm please use the shared area to keep it quiet for others.',
  ],
  seoTitle: 'Eating at the station · Pine Hill',
  seoDescription:
    'Breakfast counter, lobby tea corner and places to eat around the three Pine Hill stations: serving hours, what the room price includes and what you order separately.',
  illustrative: true,
};

const VI_INCLUDED: IncludedCopy = {
  included: [
    'Wi‑Fi trong phòng và khu chung',
    'Nước uống đóng chai tại phòng, bổ sung mỗi ngày',
    'Khăn tắm, khăn mặt, dầu gội, sữa tắm, bàn chải',
    'Điều hoà hoặc quạt (Đà Lạt: quạt và chăn dày)',
    'Gửi hành lý trước giờ nhận và sau giờ trả phòng',
    'Trà và cà phê tự phục vụ ở sảnh',
  ],
  dorm: ['Tủ khoá cá nhân cho mỗi giường', 'Rèm che, đèn đọc sách và ổ cắm riêng ở từng giường'],
  excluded: [
    'Bữa sáng, bữa tối và đồ uống khác',
    'Đưa đón sân bay, bến xe',
    'Giặt là',
    'Dịch vụ của bên thứ ba quanh ga',
  ],
};

const EN_INCLUDED: IncludedCopy = {
  included: [
    'Wi‑Fi in rooms and shared areas',
    'Bottled drinking water in the room, refilled daily',
    'Towels, shampoo, shower gel, toothbrush',
    'Air conditioning or a fan (Da Lat: fan and thick blankets)',
    'Luggage storage before check-in and after check-out',
    'Self-service tea and coffee in the lobby',
  ],
  dorm: ['A personal locker for every bed', 'Curtain, reading light and power socket at each bed'],
  excluded: [
    'Breakfast, dinner and other drinks',
    'Airport or bus station transfers',
    'Laundry',
    'Third-party services around the station',
  ],
};

const DINING: Readonly<Record<Locale, DiningPageCopy>> = {
  vi: VI_DINING,
  en: EN_DINING,
  'zh-CN': CONTENT_PACKS['zh-CN'].dining,
  ja: CONTENT_PACKS.ja.dining,
  ko: CONTENT_PACKS.ko.dining,
  ru: CONTENT_PACKS.ru.dining,
};

const INCLUDED: Readonly<Record<Locale, IncludedCopy>> = {
  vi: VI_INCLUDED,
  en: EN_INCLUDED,
  'zh-CN': CONTENT_PACKS['zh-CN'].included,
  ja: CONTENT_PACKS.ja.included,
  ko: CONTENT_PACKS.ko.included,
  ru: CONTENT_PACKS.ru.included,
};

export function diningPageCopy(locale: Locale): DiningPageCopy {
  return DINING[locale];
}

export function includedCopy(locale: Locale): IncludedCopy {
  return INCLUDED[locale];
}
