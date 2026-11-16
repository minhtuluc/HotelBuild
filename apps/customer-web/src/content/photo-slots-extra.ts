import type { PhotoSlot } from './photo-slots';

/**
 * Ô ảnh thêm ở HB-326: ảnh nhiều góc của hạng (gallery trang hạng), ảnh hoạt động quanh ga (/experiences)
 * và ảnh ăn uống (/dining). Tỉ lệ 4:3, tối thiểu 1200 × 900.
 */
export const EXTRA_PHOTOS: readonly PhotoSlot[] = [
  {
    id: 'tn-dl-pine-walk',
    where: 'Thẻ "Đi bộ rừng thông buổi sớm" ở /experiences',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Đường mòn hoặc đường nhỏ giữa đồi thông gần cơ sở, sáng sớm',
    alt: {
      vi: 'Con đường vòng qua đồi thông Đà Lạt dưới trời xanh',
      en: 'A road curving through the pine hills of Da Lat under a blue sky',
    },
  },
  {
    id: 'tn-dl-lake-ride',
    where: 'Thẻ "Đạp xe quanh hồ" ở /experiences',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Đường ven hồ Xuân Hương, ban ngày',
    alt: {
      vi: 'Hồ Xuân Hương giữa trung tâm Đà Lạt, xe máy chạy trên đường ven hồ',
      en: 'Xuan Huong Lake in central Da Lat, a motorbike on the lakeside road',
    },
  },
  {
    id: 'tn-dl-wild-sunflowers',
    where: 'Thẻ "Dã quỳ và biển mây" ở /experiences',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Dã quỳ nở ven đồi, tháng 11–12',
    alt: {
      vi: 'Khóm dã quỳ vàng nở rộ trên đồi',
      en: 'A clump of yellow wild sunflowers in full bloom',
    },
  },
  {
    id: 'tn-pt-dunes',
    where: 'Thẻ "Đồi cát lúc bình minh" ở /experiences',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Đồi cát Mũi Né lúc sáng sớm, không người',
    alt: {
      vi: 'Đồi cát Mũi Né gợn sóng dưới nắng sớm',
      en: 'Rippled sand dunes at Mui Ne in early light',
    },
  },
  {
    id: 'tn-pt-kitesurf',
    where: 'Thẻ "Xem lướt ván diều" ở /experiences',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Cánh diều trên biển mùa gió, người ở xa',
    alt: {
      vi: 'Những cánh diều lướt ván trên biển Mũi Né',
      en: 'Kitesurfing kites over the sea at Mui Ne',
    },
  },
  {
    id: 'tn-pt-fishing-village',
    where: 'Thẻ "Làng chài buổi chiều" ở /experiences',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Thuyền thúng, thuyền đánh cá về bến buổi chiều',
    alt: {
      vi: 'Thuyền đánh cá và thuyền thúng trong vịnh Mũi Né lúc ngược nắng',
      en: 'Fishing boats and basket boats in Mui Ne bay against the light',
    },
  },
  {
    id: 'tn-vt-lighthouse',
    where: 'Thẻ "Hải đăng lúc hoàng hôn" ở /experiences',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Hải đăng hoặc cảnh vịnh nhìn từ đồi hải đăng, chiều muộn',
    alt: {
      vi: 'Thành phố Vũng Tàu nhìn từ đồi hải đăng',
      en: 'Vung Tau city seen from the lighthouse hill',
    },
  },
  {
    id: 'tn-vt-early-swim',
    where: 'Thẻ "Tắm biển sớm" ở /experiences',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Bãi biển Vũng Tàu buổi sáng sớm',
    alt: {
      vi: 'Bãi Trước Vũng Tàu và núi Nhỏ nhìn từ trên cao',
      en: 'Front Beach of Vung Tau and Small Mountain seen from above',
    },
  },
  {
    id: 'tn-vt-small-mountain',
    where: 'Thẻ "Đi bộ quanh núi Nhỏ" ở /experiences',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Đường men núi Nhỏ hoặc tượng Chúa trên đỉnh',
    alt: {
      vi: 'Tượng Chúa Kitô trên đỉnh núi Nhỏ, Vũng Tàu',
      en: 'The Christ statue on top of Small Mountain, Vung Tau',
    },
  },
  {
    id: 'an-breakfast',
    where: 'Mục "Bữa sáng" ở /dining',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Món ăn sáng ở quầy của ga (bánh mì, phở…), cận cảnh',
    alt: {
      vi: 'Hai ổ bánh mì kẹp rau thơm trong giấy gói',
      en: 'Two banh mi sandwiches with fresh herbs in paper wrapping',
    },
  },
  {
    id: 'an-tea',
    where: 'Mục "Góc trà" ở /dining',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Góc trà, cà phê tự phục vụ ở sảnh',
    alt: {
      vi: 'Hai phin cà phê đang nhỏ giọt cạnh ấm trà',
      en: 'Two coffee phin filters dripping beside a teapot',
    },
  },
  {
    id: 'an-evening',
    where: 'Mục "Bữa tối quanh ga" ở /dining',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Chợ đêm hoặc quán quanh ga buổi tối',
    alt: {
      vi: 'Chợ đêm Đà Lạt đông người, đèn sáng quanh bùng binh',
      en: 'A busy Da Lat night market lit up around the roundabout',
    },
  },
  {
    id: 'hang-STD-2',
    where: 'Gallery trang hạng Standard',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Phòng tắm của hạng',
    alt: {
      vi: 'Phòng tắm có hai bồn rửa, cửa chớp gỗ và sàn gỗ',
      en: 'A bathroom with two basins, wooden shutters and a wooden floor',
    },
  },
  {
    id: 'hang-STD-3',
    where: 'Gallery trang hạng Standard',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Góc bàn viết, cửa sổ',
    alt: {
      vi: 'Góc bàn viết cạnh cửa sổ có rèm và đèn bàn',
      en: 'A writing desk by a curtained window with a desk lamp',
    },
  },
  {
    id: 'hang-SUP-2',
    where: 'Gallery trang hạng Superior',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Khoảng ngồi thêm so với Standard',
    alt: {
      vi: 'Ghế ngồi và bàn tròn cạnh cửa kính nhìn ra hàng cọ',
      en: 'Armchairs and a round table by a glass door facing palm trees',
    },
  },
  {
    id: 'hang-SUP-3',
    where: 'Gallery trang hạng Superior',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Phòng tắm của hạng',
    alt: {
      vi: 'Phòng tắm đứng vách kính, cửa sổ nhìn ra cây xanh',
      en: 'A glass-walled shower with a window onto greenery',
    },
  },
  {
    id: 'hang-DLX-2',
    where: 'Gallery trang hạng Deluxe',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Cách bố trí chỗ ngủ',
    alt: {
      vi: 'Phòng hai giường đơn, vách gỗ, cửa kính ra hiên',
      en: 'A room with two single beds, wood panelling and glass doors to a terrace',
    },
  },
  {
    id: 'hang-DLX-3',
    where: 'Gallery trang hạng Deluxe',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Ban công hoặc cửa sổ',
    alt: {
      vi: 'Phòng ngủ sáng có cửa ra ban công nhìn biển',
      en: 'A bright bedroom with a door onto a sea-view balcony',
    },
  },
  {
    id: 'hang-FAM-2',
    where: 'Gallery trang hạng Family',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Chỗ ngủ cho trẻ em',
    alt: {
      vi: 'Phòng có giường tầng gỗ và thảm sọc, hợp với trẻ em',
      en: 'A room with a wooden bunk bed and a striped rug, suited to children',
    },
  },
  {
    id: 'hang-FAM-3',
    where: 'Gallery trang hạng Family',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Góc ngồi chung',
    alt: {
      vi: 'Góc ghế bành và bàn nhỏ cạnh rèm cửa',
      en: 'An armchair and a small table beside the curtains',
    },
  },
  {
    id: 'hang-DOR-2',
    where: 'Gallery trang hạng Dorm',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Tủ khoá cá nhân',
    alt: { vi: 'Dãy tủ khoá cá nhân đánh số', en: 'A row of numbered personal lockers' },
  },
  {
    id: 'hang-DOR-3',
    where: 'Gallery trang hạng Dorm',
    ratio: '4/3',
    minSize: '1200 × 900',
    brief: 'Phòng chung nhìn từ cửa',
    alt: {
      vi: 'Phòng chung có giường tầng gỗ và giường thấp',
      en: 'A shared room with a wooden bunk bed and a low bed',
    },
  },
];
