/**
 * Quy hoạch ô ảnh của trang khách. Mỗi ô có một mã; thả file `<mã>.webp` (hoặc .jpg/.avif/.png) vào
 * `apps/customer-web/public/images/pine-hill/` là trang tự dùng ảnh đó, không cần sửa mã.
 * Ô chưa có ảnh: áp phích ga quay về tranh SVG minh hoạ; các ô khác ẩn đi.
 * Xem trước toàn bộ ô ảnh: mở trang với `?anh=1` (vd. http://localhost:3001/?anh=1).
 * Brief chụp chi tiết: docs/04-thiet-ke/anh-trang-khach.md.
 */
import type { Locale } from '../i18n/locales';

/** Câu chữ theo locale (alt ảnh): locale mới phải có đủ. */
export type Localized = Readonly<Record<Locale, string>>;

export type PhotoRatio = '3/4' | '4/3' | '3/2' | '1200/630';

export interface PhotoSlot {
  readonly id: string;
  /** Vị trí trên trang, để người chụp hình dung. */
  readonly where: string;
  readonly ratio: PhotoRatio;
  /** Kích thước tối thiểu (px) của file gốc. */
  readonly minSize: string;
  /** Cần chụp gì, một câu. */
  readonly brief: string;
  /** Văn bản thay thế cho trình đọc màn hình; sửa cho khớp ảnh thật. */
  readonly alt: Localized;
}

const station = (
  code: string,
  name: string,
  poster: string,
  room: string,
  view: string,
  alts: { readonly poster: Localized; readonly room: Localized; readonly view: Localized },
): readonly PhotoSlot[] => [
  {
    id: `ga-${code}-poster`,
    where: `Áp phích ga ${name} (dải "Ba ga trên tuyến")`,
    ratio: '3/4',
    minSize: '1200 × 1600',
    brief: poster,
    alt: alts.poster,
  },
  {
    id: `ga-${code}-phong`,
    where: `Ảnh nhỏ thứ nhất dưới thông tin ga ${name}`,
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: room,
    alt: alts.room,
  },
  {
    id: `ga-${code}-canh`,
    where: `Ảnh nhỏ thứ hai dưới thông tin ga ${name}`,
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: view,
    alt: alts.view,
  },
];

export const STATION_PHOTOS: readonly PhotoSlot[] = [
  ...station(
    'DL',
    'Đà Lạt',
    'Mặt tiền cơ sở giữa đồi thông, chụp dọc, sáng sớm còn sương, thấy rõ lối vào.',
    'Phòng Deluxe hoặc Family đã dọn sẵn, ánh sáng tự nhiên từ cửa sổ, thấy giường và cửa sổ nhìn ra thông.',
    'Đồi thông hoặc hồ gần cơ sở, đúng thứ khách nhìn thấy khi bước ra cửa (không dùng ảnh hồ Xuân Hương của người khác).',
    {
      poster: {
        vi: 'Biệt thự gỗ bên hồ bơi giữa vườn cây',
        en: 'Timber villa beside a pool in a leafy garden',
      },
      room: {
        vi: 'Phòng ngủ gỗ rộng với giường đôi và khu ghế ngồi',
        en: 'Spacious timber bedroom with a double bed and a seating area',
      },
      view: {
        vi: 'Con đường trong rừng thông Châu Sơn, Lâm Đồng',
        en: 'A road through the Chau Son pine forest, Lam Dong',
      },
    },
  ),
  ...station(
    'PT',
    'Phan Thiết',
    'Mặt tiền cơ sở hướng biển hoặc lối ra biển, chụp dọc, nắng chiều.',
    'Phòng có ban công hoặc cửa sổ hướng biển, rèm mở, ánh sáng ban ngày.',
    'Đồi cát hoặc bãi biển gần nhất lúc bình minh, có thể thấy người nhỏ ở xa (không cần xin phép khuôn mặt).',
    {
      poster: {
        vi: 'Nhà hàng bên mặt nước dưới đồi xanh',
        en: 'Waterside restaurant below green hills',
      },
      room: {
        vi: 'Phòng ngủ gỗ rộng nhìn ra vườn',
        en: 'Spacious timber bedroom looking onto the garden',
      },
      view: {
        vi: 'Cây trên đồi cát Mũi Né, Phan Thiết',
        en: 'A tree on the Mui Ne sand dunes, Phan Thiet',
      },
    },
  ),
  ...station(
    'VT',
    'Vũng Tàu',
    'Mặt tiền cơ sở, chụp dọc, thấy được biển hoặc núi Nhỏ phía sau nếu có.',
    'Phòng Standard hoặc Superior, góc rộng từ cửa vào, ánh sáng ban ngày.',
    'Biển hoặc đường lên hải đăng gần cơ sở, chiều muộn.',
    {
      poster: { vi: 'Biệt thự hồ bơi giữa đồi cây', en: 'Pool villa among wooded hills' },
      room: {
        vi: 'Phòng ngủ gỗ với giường đôi và hai ghế bên cửa sổ',
        en: 'Timber bedroom with a double bed and two chairs by the window',
      },
      view: { vi: 'Hoàng hôn trên vịnh Vũng Tàu', en: 'Sunset over the bay at Vung Tau' },
    },
  ),
];

const roomClass = (code: string, name: string, brief: string, alt: Localized): PhotoSlot => ({
  id: `hang-${code}`,
  where: `Hàng "${name}" trong dải "Hạng phòng"; cũng làm ảnh nhỏ trong bảng kết quả tìm phòng`,
  ratio: '4/3',
  minSize: '800 × 600',
  brief,
  alt,
});

export const CLASS_PHOTOS: readonly PhotoSlot[] = [
  roomClass(
    'STD',
    'Standard',
    'Phòng đôi gọn, chụp từ góc cửa, thấy toàn bộ giường đôi và lối đi.',
    {
      vi: 'Cận cảnh giường đôi trong phòng ngủ gỗ',
      en: 'Close-up of a double bed in a timber bedroom',
    },
  ),
  roomClass(
    'SUP',
    'Superior',
    'Phòng đôi rộng hơn, thấy khoảng trống thêm (ghế, bàn) so với Standard.',
    {
      vi: 'Phòng ngủ gỗ có giường đôi, bàn làm việc và khu ghế ngồi',
      en: 'Timber bedroom with a double bed, a desk and a seating area',
    },
  ),
  roomClass('DLX', 'Deluxe', 'Phòng ba người, thấy rõ chỗ nằm cho người thứ ba.', {
    vi: 'Phòng ngủ có hai giường và khu ghế ngồi nhìn ra biển',
    en: 'Bedroom with two beds and a seating area facing the sea',
  }),
  roomClass('FAM', 'Family', 'Phòng bốn người, thấy cả hai giường hoặc giường đôi + giường tầng.', {
    vi: 'Phòng ngủ có hai giường, bàn ghế và cửa sổ hướng biển',
    en: 'Bedroom with two beds, a table and chairs, and sea-facing windows',
  }),
  roomClass(
    'DOR',
    'Dorm',
    'Phòng 6 giường tầng, thấy rèm che từng giường, tủ khoá cá nhân nếu có.',
    {
      vi: 'Phòng dorm với dãy giường tầng có rèm che và ngăn kéo',
      en: 'Dorm room with a row of curtained bunk beds and drawers',
    },
  ),
];

export const SHARE_PHOTO: PhotoSlot = {
  id: 'chia-se',
  where: 'Ảnh hiện khi gửi link trang chủ qua Zalo, Facebook, Messenger',
  ratio: '1200/630',
  minSize: '1200 × 630',
  brief: 'Một ảnh ngang đẹp nhất trong ba cơ sở, chừa khoảng trống bên trái cho chữ nếu cần.',
  alt: {
    vi: 'Toàn cảnh khu nghỉ dưỡng bên vịnh lúc hoàng hôn',
    en: 'Wide view of the resort on the bay at sunset',
  },
};

export const ALL_PHOTO_SLOTS: readonly PhotoSlot[] = [
  ...STATION_PHOTOS,
  ...CLASS_PHOTOS,
  SHARE_PHOTO,
];

export function slotById(id: string): PhotoSlot | undefined {
  return ALL_PHOTO_SLOTS.find((slot) => slot.id === id);
}

/** Văn bản thay thế của ô ảnh theo locale. */
export function photoAlt(slot: PhotoSlot, locale: Locale): string {
  return slot.alt[locale];
}
