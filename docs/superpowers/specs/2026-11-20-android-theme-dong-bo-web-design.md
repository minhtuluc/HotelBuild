# Đồng bộ giao diện hai app Android với web — dự án A: nền giao diện "vé tàu"

Ngày: 20/11/2026 · Người duyệt: chủ dự án (đã duyệt trong phiên)

## Bối cảnh

Người dùng yêu cầu đồng bộ hai app Android (`customer-android`, `operations-android`) với bản web theo bốn mặt: giao diện, chức năng còn thiếu, câu chữ/ngôn ngữ, luồng/bố cục. Việc lớn nên chia thành năm dự án con, mỗi dự án có spec, kế hoạch và PR riêng:

| # | Dự án con | Ghi chú |
|---|---|---|
| **A** | Nền giao diện native (tài liệu này) | Token, font, thành phần dùng chung; áp vào hai app |
| B | Câu chữ & ngôn ngữ dùng chung | `packages/i18n`; app khách 6 ngôn ngữ, app vận hành tiếng Việt |
| C | Luồng & bố cục app khách | Khớp thứ tự bước và cách bày của web; thêm đăng ký, quên mật khẩu, điểm/hạng |
| D | Nội dung native app khách | `packages/content`; màn ga, hạng phòng, ăn uống, trải nghiệm, ảnh, ưu đãi, đường đến; ảnh tải từ web có bộ nhớ đệm |
| E | App vận hành khớp màn web | Giữ ranh giới SCR-56…68 (không đưa màn quản trị lên điện thoại) |

Thứ tự: A → B → C → D → E.

Nguồn chuẩn của hệ thiết kế là `DESIGN.md` (gốc repo) và `@pinehill/ui-web/tokens`.

## Mục tiêu của A

Hai app nhìn cùng một thương hiệu với web: ba vật liệu giấy vé hồng, bảng ga đen chữ hổ phách và nền mẫu biểu xanh xám; cùng chữ, cùng vai nút. A **không** đổi câu chữ, luồng hay bố cục màn.

## Thiết kế

### 1. Token (`packages/ui-native/src/tokens.ts`)

- **`worldInk`:** cùng tên, cùng giá trị như `ui-web`: `ground`, `ticket`, `ticketLight`, `ticketMuted`, `ticketPunch`, `board`, `boardRow`, `signal`, `signalGo`, `punch`.
- **`radius`:** đổi theo web, `{ sm: 3, md: 6, lg: 10, full: 999 }`.
- **`typography`:**
  - Giữ cỡ sp hiện có; thân bài 16sp.
  - Đậm 600 cho tiêu đề và tiền, như web.
  - Thêm `label` (12sp, 700, chữ hoa, giãn chữ 0,8; web dùng 11px nhưng native cấm cỡ dưới 12sp) và `board` (20sp, 600, chữ hẹp, chữ hoa, `tabular-nums`).
- **`fontFamily`:** tên font đã nạp:
  - `sans` / `sansMedium` / `sansSemiBold` / `sansBold` cho Be Vietnam Pro 400/500/600/700;
  - `display` / `displaySemiBold` cho Barlow Condensed 500/600.
- **`fontAssets`** (lối riêng `@pinehill/ui-native/fonts`, không export từ `index` vì module font nhập `.ttf` làm hỏng vitest chạy trong node): bảng tên → module font. Nhập theo đường dẫn từng độ đậm (`@expo-google-fonts/be-vietnam-pro/400Regular`…) để chỉ đóng gói 6 tệp. Font OFL, đóng gói offline như web.
- **Test:**
  - Mọi màu trong `color` và `worldInk` bằng đúng giá trị `ui-web`.
  - Các cặp chữ/nền dùng trong thành phần đạt WCAG AA ≥ 4,5:1.

### 2. Thành phần (`packages/ui-native/src/components/`)

Mỗi thành phần có một hàm style thuần, được test không cần renderer, và một component mỏng dùng hàm đó.

- **`Button`:**
  - Vai (`role`):
    - `accent`: đỏ dấu bấm, cho bước cam kết phía khách;
    - `primary`: mực xanh;
    - `outline`: giấy in, viền #6F625C;
    - `danger`: viền và chữ #9E1B32.
  - Cỡ: `md` cao 48dp, `lg` cao 56dp.
  - Không bấm được: nền #E9E5DF, viền #D9D2CC, chữ #5A4640; không dùng opacity.
  - `busy`: đổi nhãn, `accessibilityState.busy`.
  - Nhấn: dịch 1dp, như web.
- **`Paper`:** thẻ giấy in, viền `border`, bo 6, không có bóng.
- **`Ticket`:**
  - Khối giấy vé hồng, viền trên kẻ đôi 3dp mực xanh.
  - Đặt ngữ cảnh "trên giấy vé" để `TicketText`/`Money`/`Button` tự đổi màu chữ phụ sang `ticketMuted` và màu đỏ sang `ticketPunch` (quy tắc Ticket Ink).
- **`Board` / `BoardRow`:**
  - Nền `board`, tiêu đề chữ hổ phách chữ hoa.
  - Mỗi hàng chữ hẹp màu `darkText`; hàng đang chọn màu `signalGo`.
  - Hàng bấm được cao ≥ 48dp.
- **`Field`:**
  - Nhãn `label` phía trên ô.
  - Ô viền 1,5dp mực xanh, bo 3.
  - Khi tiêu điểm: viền 2dp.
  - Lỗi hiện dưới ô, màu `danger`, kèm chữ.
- **Thành phần nhỏ:**
  - `Money`: số đều cột, ≥ 14sp.
  - `StatusBadge`: viền mảnh kèm chữ, không chỉ dựa vào màu.
  - `ScreenTitle`: tiêu đề màn, không có nhãn nhỏ phía trên.
  - `Step`: "Bước n/m".
- **`FontGate`:** nạp font bằng `expo-font` (đã autolink qua gói `expo`, không phải build lại APK). Font là asset cục bộ nên chỉ mất vài trăm ms: `FontGate` chờ nạp xong rồi mới render; nếu nạp lỗi thì vẫn render bằng font hệ thống. Trên Android, độ đậm đổi bằng tên họ chữ, không đặt `fontWeight`.

### 3. Theme dùng chung

Hai file `theme.ts` của hai app hiện giống hệt nhau. Gộp thành `createTheme(surface)` trong `ui-native`, với `surface: 'guest' | 'ops'`.

- **Tên khoá:** giữ nguyên các khoá đang dùng (`screen`, `scroll`, `card`, `field`, `buttonPrimary`, `title`, `body`, `muted`, `tabular`…), để mọi màn đổi giao diện mà không phải sửa từng màn.
- **`guest`:**
  - Nền `ground`.
  - Header và tab bar màu `board`, chữ `signal`; tab đang chọn màu `signal`.
  - `buttonPrimary` là mực xanh (nút tiện ích: tra cứu, đăng nhập, lọc). Khoá mới `buttonAccent` là đỏ dấu bấm, chỉ dùng cho bước cam kết (tìm phòng, giữ chỗ, thanh toán), đúng DESIGN.md. Sửa sau lần chạy máy thật đầu tiên, khi nút "Tra cứu" bị tô đỏ.
- **`ops`:**
  - Nền `bg` #F3F2EE.
  - Header màu `board`, chữ `darkText`.
  - `buttonPrimary` là mực xanh.
- **Tiêu đề:** dùng font `displaySemiBold` ở app khách. App vận hành giữ chữ thân cho tiêu đề màn, theo quy tắc back-office của web.
- **Thanh trạng thái:** chuyển sang chữ sáng (`light-content`) cho hợp header bảng ga. `useDarkStatusBar` (HB-267, PR #353 chưa merge) được tổng quát thành `useStatusBarStyle(style)`, giữ nguyên cơ chế áp lại sau 1,5 giây. Hai PR áp vào app xếp chồng lên nhánh #353.

### 4. Áp vào hai app

- `src/theme.ts` mỗi app chỉ còn `export const { theme, stackScreenOptions, tabScreenOptions } = createTheme('guest' | 'ops')`.
- `app/_layout.tsx` bọc `FontGate` và đặt kiểu thanh trạng thái.
- Các nút đang tự dựng bằng `Pressable` + `theme.buttonPrimary` vẫn chạy với style mới. Việc đổi sang `Button` thuộc C và E.

## Ngoài phạm vi A

Câu chữ (B), luồng và bố cục (C, E), màn nội dung (D), chuyển động.

## Kiểm thử

1. `ui-native`:
   - Token trùng web.
   - Tương phản AA.
   - Hàm style của `Button`, `Ticket`, `Board`, `Field` ứng với từng vai, cỡ và trạng thái.
   - `createTheme` có đủ khoá cũ và đổi màu đúng theo `surface`.
2. Hai app: typecheck, lint và test hiện có giữ xanh.
3. Máy thật:
   - Chụp màn hình trước/sau: mọi màn của app khách; màn chính, khách đến, tra cứu và đối soát của app vận hành.
   - Font Be Vietnam Pro và Barlow hiện đúng dấu tiếng Việt.

## Giao hàng

| PR | Nội dung |
|---|---|
| HB-272 | `ui-native`: token, font, thành phần, `createTheme`, kèm spec này |
| HB-273 | App khách: áp theme `guest` |
| HB-274 | App vận hành: áp theme `ops` |
