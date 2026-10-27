/**
 * HB-185 — bảng 83 màn hình của thiết kế (`docs/04-thiet-ke/thiet-ke-man-hinh.md` §3) dùng cho
 * lượt quét axe tập trung. Nguồn chuẩn là **danh mục thiết kế**, không phải danh sách tuyến hiện có:
 * màn chưa thi công vẫn phải có dòng, và trạng thái của nó là `blocked` kèm lý do đọc được — không
 * màn nào được biến mất khỏi báo cáo.
 *
 * Quy ước:
 * - `surface` quyết định project Playwright chạy lượt quét (`customer-web` / `operations-web`).
 * - `path` là tuyến thật trong mã nguồn; `{bookingId}` được fixture thay bằng id booking tổng hợp.
 * - `ready` là `data-testid` chỉ xuất hiện khi màn đã hiển thị nội dung (không quét lúc còn tải).
 * - `fixture` là khoá trong `fixtures.ts` dựng phiên/API giả đủ để màn đạt trạng thái sẵn sàng.
 * - `blocked` **không** phải bỏ qua âm thầm: spec gọi `test.skip()` với đúng `reason` dưới đây và
 *   vẫn đếm dòng đó vào tổng 83.
 *
 * Dòng danh mục đã đọc: `docs/04-thiet-ke/thiet-ke-man-hinh.md:181-283` (§3.1 web khách 13,
 * §3.2 operations web 44, §3.3 customer Android 13, §3.4 operations Android 13 — tổng 83).
 */

export type Surface = 'customer-web' | 'operations-web' | 'android';

export type FixtureName =
  | 'customer-public'
  | 'customer-guest'
  | 'customer-booking'
  | 'customer-booking-paid'
  | 'customer-bookings-list'
  | 'customer-profile'
  | 'ops-anonymous'
  | 'ops-users'
  | 'ops-audit'
  | 'ops-settings'
  | 'ops-properties'
  | 'ops-room-types'
  | 'ops-rooms'
  | 'ops-room-blocks'
  | 'ops-day-board'
  | 'ops-inventory-grid'
  | 'ops-allotments'
  | 'ops-rate-calendar'
  | 'ops-seasons'
  | 'ops-channels'
  | 'ops-promotions'
  | 'ops-multi-channel-quote'
  | 'ops-rate-plans'
  | 'ops-bookings'
  | 'ops-booking-detail'
  | 'ops-booking-new'
  | 'ops-booking-reschedule'
  | 'ops-booking-cancel'
  | 'ops-collect'
  | 'ops-refunds'
  | 'ops-front-desk'
  | 'ops-crm-guests'
  | 'ops-crm-loyalty'
  | 'ops-noti'
  | 'ops-reports';

export interface Screen {
  readonly id: string;
  readonly name: string;
  readonly surface: Surface;
  readonly path: string;
  readonly ready: string;
  readonly fixture?: FixtureName;
  readonly status: 'scannable' | 'blocked';
  readonly reason?: string;
}

/** Lý do dùng chung cho 26 màn Android (13 khách + 13 vận hành). */
const NO_ANDROID_DEVICE =
  'Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có.';
/** Lý do dùng chung cho màn thiết kế chưa có tuyến trong mã nguồn. */
const notBuilt = (detail: string): string => `Chưa có tuyến/màn trong mã nguồn (${detail}); không có bề mặt để quét.`;

export const SCREENS: readonly Screen[] = [
  // ── §3.1 Web khách (13) ────────────────────────────────────────────────────────────────────────
  {
    id: 'SCR-01',
    name: 'Trang chủ & khối tìm phòng',
    surface: 'customer-web',
    path: '/',
    ready: 'search-block',
    fixture: 'customer-public',
    status: 'scannable',
  },
  {
    id: 'SCR-02',
    name: 'Kết quả tìm phòng',
    surface: 'customer-web',
    path: '/search?propertyId=synthetic-property&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0',
    ready: 'availability-table',
    fixture: 'customer-public',
    status: 'scannable',
  },
  {
    id: 'SCR-03',
    name: 'Chi tiết phòng & bảng giá từng đêm',
    surface: 'customer-web',
    path: '/rooms/synthetic-room?propertyId=synthetic-property&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0',
    ready: 'nights-table',
    fixture: 'customer-public',
    status: 'scannable',
  },
  {
    id: 'SCR-04',
    name: 'Chọn gói giá & chính sách huỷ',
    surface: 'customer-web',
    // SCR-04/05 cùng một tuyến `/book` (bước 4/4); mỗi màn quét phần nội dung riêng của mình.
    path: '/book?propertyId=synthetic-property&roomTypeId=synthetic-room&ratePlanCode=FLEX7&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0&roomCount=1',
    ready: 'plan-terms',
    fixture: 'customer-guest',
    status: 'scannable',
  },
  {
    id: 'SCR-05',
    name: 'Thông tin khách & xác nhận đặt',
    surface: 'customer-web',
    path: '/book?propertyId=synthetic-property&roomTypeId=synthetic-room&ratePlanCode=FLEX7&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0&roomCount=1',
    ready: 'guest-form',
    fixture: 'customer-guest',
    status: 'scannable',
  },
  {
    id: 'SCR-06',
    name: 'Thanh toán trực tuyến',
    surface: 'customer-web',
    path: '/booking/{bookingId}/pay',
    ready: 'payment-screen',
    fixture: 'customer-booking',
    status: 'scannable',
  },
  {
    id: 'SCR-07',
    name: 'Kết quả đặt phòng & đếm ngược giữ chỗ',
    surface: 'customer-web',
    path: '/booking/{bookingId}',
    ready: 'booking-result',
    fixture: 'customer-booking',
    status: 'scannable',
  },
  {
    id: 'SCR-08',
    name: 'Đăng ký / đăng nhập khách',
    surface: 'customer-web',
    // Một màn nhiều tuyến (đăng nhập/đăng ký/quên/đặt lại); quét tuyến đăng nhập làm đại diện.
    path: '/account/login',
    ready: 'login-screen',
    fixture: 'customer-public',
    status: 'scannable',
  },
  {
    id: 'SCR-09',
    name: 'Đơn của tôi',
    surface: 'customer-web',
    path: '/bookings',
    ready: 'bookings-list',
    fixture: 'customer-bookings-list',
    status: 'scannable',
  },
  {
    id: 'SCR-10',
    name: 'Chi tiết booking của tôi',
    surface: 'customer-web',
    path: '/bookings/{bookingId}',
    ready: 'booking-detail-code',
    fixture: 'customer-booking',
    status: 'scannable',
  },
  {
    id: 'SCR-11',
    name: 'Huỷ đặt phòng & số tiền hoàn theo bậc',
    surface: 'customer-web',
    path: '/bookings/{bookingId}/cancel',
    ready: 'cancel-screen',
    fixture: 'customer-booking-paid',
    status: 'scannable',
  },
  {
    id: 'SCR-12',
    name: 'Đổi ngày lưu trú',
    surface: 'customer-web',
    path: '/bookings/{bookingId}/reschedule',
    ready: 'reschedule-screen',
    fixture: 'customer-booking',
    status: 'scannable',
  },
  {
    id: 'SCR-13',
    name: 'Hồ sơ khách & điểm thưởng',
    surface: 'customer-web',
    path: '/profile',
    ready: 'profile-card',
    fixture: 'customer-profile',
    status: 'scannable',
  },

  // ── §3.2 Operations Web (44) ──────────────────────────────────────────────────────────────────
  {
    id: 'SCR-14',
    name: 'Đăng nhập nội bộ & chọn cơ sở',
    surface: 'operations-web',
    path: '/login',
    ready: 'login-submit',
    fixture: 'ops-anonymous',
    status: 'scannable',
  },
  {
    id: 'SCR-15',
    name: 'Người dùng, vai trò & phạm vi cơ sở',
    surface: 'operations-web',
    path: '/admin/users',
    ready: 'users-screen',
    fixture: 'ops-users',
    status: 'scannable',
  },
  {
    id: 'SCR-16',
    name: 'Nhật ký kiểm toán',
    surface: 'operations-web',
    path: '/audit-logs',
    ready: 'audit-table',
    fixture: 'ops-audit',
    status: 'scannable',
  },
  {
    id: 'SCR-17',
    name: 'Tham số hệ thống',
    surface: 'operations-web',
    path: '/system-settings',
    ready: 'settings-table',
    fixture: 'ops-settings',
    status: 'scannable',
  },
  {
    id: 'SCR-18',
    name: 'Sao lưu & phục hồi',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có `apps/operations-web/src/app/**/backup*`; F2 chưa giao màn HB tương ứng'),
  },
  {
    id: 'SCR-19',
    name: 'Cơ sở',
    surface: 'operations-web',
    path: '/properties',
    ready: 'properties-table',
    fixture: 'ops-properties',
    status: 'scannable',
  },
  {
    id: 'SCR-20',
    name: 'Loại phòng, sức chứa & sàn–trần giá',
    surface: 'operations-web',
    path: '/room-types',
    ready: 'room-types-table',
    fixture: 'ops-room-types',
    status: 'scannable',
  },
  {
    id: 'SCR-21',
    name: 'Sơ đồ buồng & phòng vật lý',
    surface: 'operations-web',
    path: '/rooms',
    ready: 'rooms-table',
    fixture: 'ops-rooms',
    status: 'scannable',
  },
  {
    id: 'SCR-22',
    name: 'Khoá phòng bảo trì / ngừng bán',
    surface: 'operations-web',
    path: '/room-blocks',
    ready: 'room-blocks-table',
    fixture: 'ops-room-blocks',
    status: 'scannable',
  },
  {
    id: 'SCR-23',
    name: 'Bảng điều khiển ngày',
    surface: 'operations-web',
    path: '/day-board',
    ready: 'day-row-rt1',
    fixture: 'ops-day-board',
    status: 'scannable',
  },
  {
    id: 'SCR-24',
    name: 'Lưới tồn phòng theo ngày',
    surface: 'operations-web',
    path: '/inventory-grid',
    ready: 'inventory-grid',
    fixture: 'ops-inventory-grid',
    status: 'scannable',
  },
  {
    id: 'SCR-25',
    name: 'Allotment theo kênh',
    surface: 'operations-web',
    path: '/channel-allotments',
    ready: 'allotments-table',
    fixture: 'ops-allotments',
    status: 'scannable',
  },
  {
    id: 'SCR-26',
    name: 'Lịch giá & giá cơ bản',
    surface: 'operations-web',
    path: '/rate-calendar',
    ready: 'rate-calendar-table',
    fixture: 'ops-rate-calendar',
    status: 'scannable',
  },
  {
    id: 'SCR-27',
    name: 'Mùa & hệ số mùa',
    surface: 'operations-web',
    path: '/seasons',
    ready: 'seasons-calendar',
    fixture: 'ops-seasons',
    status: 'scannable',
  },
  {
    id: 'SCR-28',
    name: 'Kênh bán: hệ số & hoa hồng',
    surface: 'operations-web',
    path: '/channels',
    ready: 'channels-table',
    fixture: 'ops-channels',
    status: 'scannable',
  },
  {
    id: 'SCR-29',
    name: 'Khuyến mãi',
    surface: 'operations-web',
    path: '/promotions',
    ready: 'promotions-table',
    fixture: 'ops-promotions',
    status: 'scannable',
  },
  {
    id: 'SCR-30',
    name: 'Xem trước báo giá đa kênh',
    surface: 'operations-web',
    path: '/multi-channel-quote',
    ready: 'mcq-table',
    fixture: 'ops-multi-channel-quote',
    status: 'scannable',
  },
  {
    id: 'SCR-70',
    name: 'Gói giá & chính sách huỷ',
    surface: 'operations-web',
    path: '/rate-plans',
    ready: 'rate-plans-table',
    fixture: 'ops-rate-plans',
    status: 'scannable',
  },
  {
    id: 'SCR-31',
    name: 'Danh sách & tra cứu booking',
    surface: 'operations-web',
    path: '/bookings',
    ready: 'booking-row-PH-2601-00001',
    fixture: 'ops-bookings',
    status: 'scannable',
  },
  {
    id: 'SCR-32',
    name: 'Chi tiết booking & nút huỷ',
    surface: 'operations-web',
    path: '/bookings/b1',
    ready: 'booking-detail',
    fixture: 'ops-booking-detail',
    status: 'scannable',
  },
  {
    id: 'SCR-33',
    name: 'Tạo booking tại quầy (khách vãng lai)',
    surface: 'operations-web',
    path: '/bookings/new',
    ready: 'new-booking-step',
    fixture: 'ops-booking-new',
    status: 'scannable',
  },
  {
    id: 'SCR-34',
    name: 'Tạo booking qua điện thoại',
    surface: 'operations-web',
    // SCR-33/34 dùng chung tuyến 5 bước, khác nhau ở kênh tạo (WALKIN/PHONE); quét cùng bề mặt.
    path: '/bookings/new',
    ready: 'new-booking-step',
    fixture: 'ops-booking-new',
    status: 'scannable',
  },
  {
    id: 'SCR-35',
    name: 'Sửa đổi booking & đổi ngày',
    surface: 'operations-web',
    path: '/bookings/b1/reschedule',
    ready: 'reschedule-screen',
    fixture: 'ops-booking-reschedule',
    status: 'scannable',
  },
  {
    id: 'SCR-36',
    name: 'Huỷ booking & tính hoàn theo bậc',
    surface: 'operations-web',
    path: '/bookings/b1/cancel',
    ready: 'cancel-booking',
    fixture: 'ops-booking-cancel',
    status: 'scannable',
  },
  {
    id: 'SCR-37',
    name: 'Thu cọc / thu số dư tại quầy',
    surface: 'operations-web',
    path: '/bookings/b1/collect',
    ready: 'collect-screen',
    fixture: 'ops-collect',
    status: 'scannable',
  },
  {
    id: 'SCR-38',
    name: 'Yêu cầu & duyệt hoàn tiền hai cấp',
    surface: 'operations-web',
    path: '/bookings/{bookingId}/refunds',
    ready: 'refund-detail',
    fixture: 'ops-refunds',
    status: 'scannable',
  },
  {
    id: 'SCR-39',
    name: 'Đối soát doanh thu, hoa hồng & công nợ',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có `apps/operations-web/src/app/**/reconciliation*`; F6 chưa giao màn'),
  },
  {
    id: 'SCR-40',
    name: 'Cấu hình kênh bán',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('chưa có tuyến cấu hình kênh riêng; `/channels` chỉ là SCR-28 (hệ số & hoa hồng)'),
  },
  {
    id: 'SCR-41',
    name: 'Giám sát đồng bộ kênh & outbox',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có tuyến giám sát outbox/đồng bộ kênh'),
  },
  {
    id: 'SCR-42',
    name: 'Hàng đợi booking OTA nhận vào',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có tuyến hàng đợi booking OTA'),
  },
  {
    id: 'SCR-43',
    name: 'Bảng điều khiển quá tải',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có tuyến bảng điều khiển quá tải (chỉ có báo cáo SCR-55)'),
  },
  {
    id: 'SCR-44',
    name: 'Đề xuất & thực hiện điều chuyển phòng',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có tuyến điều chuyển phòng'),
  },
  {
    id: 'SCR-45',
    name: 'Ghép phòng hai booking',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có tuyến ghép phòng'),
  },
  {
    id: 'SCR-46',
    name: 'Walk-out & bồi thường',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có tuyến walk-out/bồi thường'),
  },
  {
    id: 'SCR-47',
    name: 'Duyệt ngoại lệ chính sách',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có tuyến duyệt ngoại lệ chính sách'),
  },
  {
    id: 'SCR-48',
    name: 'Bàn tiền sảnh: đến – đi – ở trong ngày',
    surface: 'operations-web',
    path: '/front-desk?date=2026-12-24',
    ready: 'front-desk-screen',
    fixture: 'ops-front-desk',
    status: 'scannable',
  },
  {
    id: 'SCR-49',
    name: 'Hồ sơ khách & danh sách đen',
    surface: 'operations-web',
    path: '/crm/guests',
    ready: 'guests-table',
    fixture: 'ops-crm-guests',
    status: 'scannable',
  },
  {
    id: 'SCR-50',
    name: 'Hạng khách & điểm thưởng',
    surface: 'operations-web',
    path: '/crm/loyalty?guestId=g1',
    ready: 'loyalty-table',
    fixture: 'ops-crm-loyalty',
    status: 'scannable',
  },
  {
    id: 'SCR-51',
    name: 'Mẫu & hàng đợi thông báo',
    surface: 'operations-web',
    path: '/noti/notifications',
    ready: 'noti-table',
    fixture: 'ops-noti',
    status: 'scannable',
  },
  {
    id: 'SCR-52',
    name: 'Báo cáo công suất, ADR/RevPAR',
    surface: 'operations-web',
    path: '/reports/occupancy',
    ready: 'occupancy-row-2026-12-24',
    fixture: 'ops-reports',
    status: 'scannable',
  },
  {
    id: 'SCR-53',
    name: 'Báo cáo doanh thu theo kênh',
    surface: 'operations-web',
    path: '/reports/revenue-by-channel',
    ready: 'revenue-total',
    fixture: 'ops-reports',
    status: 'scannable',
  },
  {
    id: 'SCR-54',
    name: 'Báo cáo huỷ phòng & hoàn cọc',
    surface: 'operations-web',
    path: '/reports/cancellations',
    ready: 'cancel-summary',
    fixture: 'ops-reports',
    status: 'scannable',
  },
  {
    id: 'SCR-55',
    name: 'Báo cáo quá tải & điều chuyển',
    surface: 'operations-web',
    path: '/reports/overbooking',
    ready: 'overbooking-summary',
    fixture: 'ops-reports',
    status: 'scannable',
  },
  {
    id: 'SCR-69',
    name: 'Xử lý trả phòng sớm',
    surface: 'operations-web',
    path: '',
    ready: '',
    status: 'blocked',
    reason: notBuilt('không có tuyến trả phòng sớm; `/front-desk` (SCR-48) chưa mở luồng này'),
  },

  // ── §3.3 Customer Android (13) ────────────────────────────────────────────────────────────────
  {
    id: 'SCR-71',
    name: 'Đăng ký / đăng nhập khách (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-72',
    name: 'Trang chủ & tìm phòng (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-73',
    name: 'Kết quả tìm phòng (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-74',
    name: 'Chi tiết phòng & bảng giá (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-75',
    name: 'Gói giá & chính sách huỷ (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-76',
    name: 'Thông tin khách & xác nhận (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-77',
    name: 'Thanh toán trực tuyến (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-78',
    name: 'Kết quả đặt phòng (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-79',
    name: 'Đơn của tôi (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-80',
    name: 'Chi tiết booking (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-81',
    name: 'Huỷ booking & số tiền hoàn (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-82',
    name: 'Đổi ngày lưu trú (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-83',
    name: 'Hồ sơ khách & điểm thưởng (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },

  // ── §3.4 Operations Android (13) ─────────────────────────────────────────────────────────────
  {
    id: 'SCR-56',
    name: 'Đăng nhập & chọn cơ sở (PIN)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-57',
    name: 'Danh sách khách đến hôm nay',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-58',
    name: 'Chi tiết check-in',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-59',
    name: 'Thu số dư khi check-in',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-60',
    name: 'Danh sách khách đi hôm nay',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-61',
    name: 'Check-out muộn & phụ thu',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-62',
    name: 'Tra cứu booking & khách',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-63',
    name: 'Đổi phòng trên Android',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-64',
    name: 'Ghi no-show',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-65',
    name: 'Tạo booking khách vãng lai (Android)',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-66',
    name: 'Buồng phòng: danh sách việc dọn',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-67',
    name: 'Cảnh báo quá tải & việc gấp',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
  {
    id: 'SCR-68',
    name: 'Đối soát nhanh theo ngày',
    surface: 'android',
    path: '',
    ready: '',
    status: 'blocked',
    reason: NO_ANDROID_DEVICE,
  },
] as const;

/** Tổng danh mục thiết kế — dùng để khẳng định không màn nào biến mất khỏi báo cáo. */
export const TOTAL_SCREENS = 83;

export const BLOCKED_SCREENS = SCREENS.filter((screen) => screen.status === 'blocked');
export const SCANNABLE_SCREENS = SCREENS.filter((screen) => screen.status === 'scannable');

/** Bề mặt Android không có project Playwright tương ứng nên luôn `blocked`. */
export function projectFor(surface: Surface): 'customer-web' | 'operations-web' | null {
  if (surface === 'android') return null;
  return surface;
}
