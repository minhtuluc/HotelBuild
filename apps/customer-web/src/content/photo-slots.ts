/**
 * Quy hoạch ô ảnh của trang khách. Mỗi ô có một mã; thả file `<mã>.webp` (hoặc .jpg/.avif/.png) vào
 * `apps/customer-web/public/images/pine-hill/` là trang tự dùng ảnh đó, không cần sửa mã.
 * Ô chưa có ảnh: áp phích ga quay về tranh SVG minh hoạ; các ô khác ẩn đi.
 * Xem trước toàn bộ ô ảnh: mở trang với `?anh=1` (vd. http://localhost:3001/?anh=1).
 * Brief chụp chi tiết: docs/04-thiet-ke/anh-trang-khach.md.
 */

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
  readonly alt: string;
}

const station = (
  code: string,
  name: string,
  poster: string,
  room: string,
  view: string,
  alts: { readonly poster: string; readonly room: string; readonly view: string },
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
      poster: 'Biệt thự gỗ bên hồ bơi giữa vườn cây',
      room: 'Phòng ngủ gỗ rộng với giường đôi và khu ghế ngồi',
      view: 'Con đường trong rừng thông Châu Sơn, Lâm Đồng',
    },
  ),
  ...station(
    'PT',
    'Phan Thiết',
    'Mặt tiền cơ sở hướng biển hoặc lối ra biển, chụp dọc, nắng chiều.',
    'Phòng có ban công hoặc cửa sổ hướng biển, rèm mở, ánh sáng ban ngày.',
    'Đồi cát hoặc bãi biển gần nhất lúc bình minh, có thể thấy người nhỏ ở xa (không cần xin phép khuôn mặt).',
    {
      poster: 'Nhà hàng bên mặt nước dưới đồi xanh',
      room: 'Phòng ngủ gỗ rộng nhìn ra vườn',
      view: 'Cây trên đồi cát Mũi Né, Phan Thiết',
    },
  ),
  ...station(
    'VT',
    'Vũng Tàu',
    'Mặt tiền cơ sở, chụp dọc, thấy được biển hoặc núi Nhỏ phía sau nếu có.',
    'Phòng Standard hoặc Superior, góc rộng từ cửa vào, ánh sáng ban ngày.',
    'Biển hoặc đường lên hải đăng gần cơ sở, chiều muộn.',
    {
      poster: 'Biệt thự hồ bơi giữa đồi cây',
      room: 'Phòng ngủ gỗ với giường đôi và hai ghế bên cửa sổ',
      view: 'Hoàng hôn trên vịnh Vũng Tàu',
    },
  ),
];

const roomClass = (code: string, name: string, brief: string, alt: string): PhotoSlot => ({
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
    'Cận cảnh giường đôi trong phòng ngủ gỗ',
  ),
  roomClass(
    'SUP',
    'Superior',
    'Phòng đôi rộng hơn, thấy khoảng trống thêm (ghế, bàn) so với Standard.',
    'Phòng ngủ gỗ có giường đôi, bàn làm việc và khu ghế ngồi',
  ),
  roomClass(
    'DLX',
    'Deluxe',
    'Phòng ba người, thấy rõ chỗ nằm cho người thứ ba.',
    'Phòng ngủ có hai giường và khu ghế ngồi nhìn ra biển',
  ),
  roomClass(
    'FAM',
    'Family',
    'Phòng bốn người, thấy cả hai giường hoặc giường đôi + giường tầng.',
    'Phòng ngủ có hai giường, bàn ghế và cửa sổ hướng biển',
  ),
  roomClass(
    'DOR',
    'Dorm',
    'Phòng 6 giường tầng, thấy rèm che từng giường, tủ khoá cá nhân nếu có.',
    'Phòng dorm với dãy giường tầng có rèm che và ngăn kéo',
  ),
];

export const SHARE_PHOTO: PhotoSlot = {
  id: 'chia-se',
  where: 'Ảnh hiện khi gửi link trang chủ qua Zalo, Facebook, Messenger',
  ratio: '1200/630',
  minSize: '1200 × 630',
  brief: 'Một ảnh ngang đẹp nhất trong ba cơ sở, chừa khoảng trống bên trái cho chữ nếu cần.',
  alt: 'Toàn cảnh khu nghỉ dưỡng bên vịnh lúc hoàng hôn',
};

export const ALL_PHOTO_SLOTS: readonly PhotoSlot[] = [
  ...STATION_PHOTOS,
  ...CLASS_PHOTOS,
  SHARE_PHOTO,
];

export function slotById(id: string): PhotoSlot | undefined {
  return ALL_PHOTO_SLOTS.find((slot) => slot.id === id);
}
