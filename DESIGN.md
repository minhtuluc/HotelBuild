---
name: Pine Hill
description: Đặt phòng trực tiếp ba cơ sở Pine Hill, kể bằng vé tàu và bảng ga
colors:
  print-blue: "#1B3A82"
  punch-red: "#B8341C"
  punch-red-on-ticket: "#962A16"
  ticket-pink: "#F0C2B3"
  ticket-pink-light: "#F6DCD3"
  ticket-muted: "#6B2F22"
  form-ground: "#DFE5F0"
  board-black: "#121614"
  board-row: "#1C221F"
  signal-amber: "#F2B632"
  signal-green: "#7CD08A"
  work-ground: "#F3F2EE"
  paper: "#FBFAF7"
  paper-muted: "#E9E5DF"
  line: "#D9D2CC"
  line-strong: "#6F625C"
  ink: "#1A1716"
  ink-muted: "#5A4640"
  board-text: "#F4EFE6"
  board-text-muted: "#A9B3AC"
  danger: "#9E1B32"
  warning: "#8A4B06"
  success: "#17663A"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, Be Vietnam Pro, sans-serif"
    fontSize: "clamp(3rem, 6vw, 5.75rem)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2.4rem, 4.6vw, 4rem)"
    fontWeight: 600
    lineHeight: 1
  title:
    fontFamily: "Be Vietnam Pro, Segoe UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Be Vietnam Pro, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Be Vietnam Pro, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.08em"
  board:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
    fontFeature: "tnum"
rounded:
  ticket-field: "2px"
  sm: "3px"
  ticket: "6px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s6: "24px"
  s8: "32px"
  s12: "48px"
  band: "clamp(56px, 8vw, 104px)"
components:
  button-punch:
    backgroundColor: "{colors.punch-red}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    height: "44px"
    padding: "10px 18px"
  button-punch-hover:
    backgroundColor: "#962A16"
  button-punch-lg:
    backgroundColor: "{colors.punch-red}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    height: "52px"
    padding: "12px 26px"
  button-ticket-submit:
    backgroundColor: "{colors.punch-red}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    height: "56px"
  button-print:
    backgroundColor: "{colors.print-blue}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    height: "44px"
    padding: "10px 18px"
  button-print-hover:
    backgroundColor: "#142C63"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "44px"
    padding: "10px 18px"
  button-disabled:
    backgroundColor: "#E9E5DF"
    textColor: "#5A4640"
    rounded: "{rounded.sm}"
    height: "44px"
  ticket-field:
    backgroundColor: "rgba(255,255,255,0.38)"
    textColor: "{colors.ink}"
    rounded: "{rounded.ticket-field}"
    padding: "7px 12px 4px"
  board-row:
    backgroundColor: "{colors.board-row}"
    textColor: "{colors.signal-amber}"
    padding: "8px 10px"
  nav-rail-active:
    backgroundColor: "{colors.ticket-pink}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
---

# Design System: Pine Hill

## Overview

**Creative North Star: "Tuyến Pine Hill"**

Ba cơ sở Pine Hill (Đà Lạt, Phan Thiết, Vũng Tàu) là ba ga trên một tuyến. Đặt phòng giống mua vé: chọn ga đến, mỗi đêm là một chặng có giá in riêng, huỷ là trả vé theo số giờ trước giờ tàu chạy. Thế giới này không phải trang trí: nó là cách kể lại đúng cơ chế nghiệp vụ mà OTA không cho khách thấy (giá từng đêm, mốc hoàn theo giờ, giữ chỗ có hạn).

Ba vật liệu dựng nên mọi màn: **giấy vé hồng** in chìm hoa văn (form, vé mẫu, dải giá), **bảng ga đen chữ hổ phách** (danh sách cơ sở, bảng trả vé, thanh bên back-office), và **giấy mẫu biểu nhà ga** màu xanh xám làm nền. Chữ cạnh hẹp như biển ga cho tiêu đề và số; chữ thân Be Vietnam Pro để đọc lâu bằng tiếng Việt.

Trang khách (Persuade) dùng thế giới ở mức đầy đủ: vé là form, bảng ga là dữ liệu, áp phích ga là ảnh. Back-office (Operate) chỉ mượn bảng màu, chữ và một dấu ấn (thanh bên bảng ga, mục đang mở là tấm vé hồng, đồng hồ giờ VN); bố cục, điều hướng và control giữ chuẩn ứng dụng web.

**Key Characteristics:**
- Mỗi đêm một chặng: giá luôn hiện theo từng đêm, không chỉ tổng.
- Ba vật liệu, không thêm vật liệu thứ tư.
- Không ảnh hero; tấm vé là trung tâm màn đầu.
- Chữ thân tiếng Việt đọc được ở 15px, số luôn `tabular-nums`.
- Mọi số tiền, mốc hoàn, tình trạng phòng đến từ API hoặc tài liệu nghiệp vụ.

## Colors

Mực xanh và đỏ dấu bấm trên giấy hồng, trên nền xanh xám, cạnh bảng đen chữ hổ phách.

### Primary
- **Mực in xanh** (#1B3A82): chữ in trên vé, đường kẻ đôi, liên kết, nút chính ở back-office, vòng tiêu điểm. 8,4:1 trên nền mẫu biểu, 6,6:1 trên giấy vé.

### Secondary
- **Đỏ dấu bấm** (#B8341C): hành động chính phía khách (Tìm phòng, Giữ chỗ), lỗ bấm trên logo. Trên giấy vé hồng đổi sang **Đỏ dấu bấm đậm** (#962A16) để đạt 4,95:1.

### Tertiary
- **Hổ phách bảng ga** (#F2B632): chữ trên bảng ga, tiêu đề nhóm thanh bên, đồng hồ. 10:1 trên bảng đen.
- **Xanh còn chỗ** (#7CD08A): ga/hàng đang chọn trên bảng, mốc hoàn 100%.

### Neutral
- **Giấy vé hồng** (#F0C2B3): vé tìm phòng, vé mẫu, dải hạng phòng, tờ đăng nhập. Chữ phụ trên giấy vé dùng **Nâu mực vé** (#6B2F22, 6,4:1).
- **Giấy mẫu biểu nhà ga** (#DFE5F0): nền trang khách. Chọn có chủ ý để tránh nền kem/be mặc định.
- **Bảng ga** (#121614) và **hàng bảng** (#1C221F): đầu/chân trang khách, dải trả vé, thanh bên back-office.
- **Giấy in** (#FBFAF7), **nền làm việc** (#F3F2EE): thẻ, bảng, form và nền màn back-office.
- **Mực** (#1A1716), **mực phụ** (#5A4640), **đường kẻ** (#D9D2CC / #6F625C).

### Named Rules
**The Ticket Ink Rule.** Trên mọi bề mặt giấy vé hồng, chữ phụ đổi sang #6B2F22 và đỏ hành động đổi sang #962A16 (đặt bằng biến CSS cục bộ trên `.ph-ticket`, `.ph-sample`, `.ph-band-ticket`, `.ph-price-strip`). Không dùng xám trên nền màu.

**The No Cream Rule.** Nền trang không bao giờ là kem/be. Nền khách là giấy mẫu biểu xanh xám; màu ấm chỉ nằm trên vật thể (vé).

## Typography

**Display Font:** Barlow Condensed 500/600 (với Arial Narrow)
**Body Font:** Be Vietnam Pro 400/500/600/700 (với Segoe UI, system-ui)

**Character:** Chữ cạnh hẹp của biển ga và bảng giờ tàu đi cùng một chữ không chân do người Việt thiết kế, đủ dấu, đọc êm ở cỡ nhỏ. Cả hai đóng gói cục bộ (OFL), không phụ thuộc CDN.

### Hierarchy
- **Display** (600, clamp(3rem, 6vw, 5.75rem), 0.98): tiêu đề màn đầu trang khách, hai dòng, dòng hai màu mực xanh.
- **Headline** (600, clamp(2.4rem, 4.6vw, 4rem), 1): tiêu đề mỗi dải nội dung, tiêu đề trang trong (2.2–3.25rem).
- **Board** (600, 20–28px, chữ hoa, tnum): chữ trên bảng ga, mệnh giá chặng, số trên cuống vé (64px).
- **Title** (600, 24px, 1.25): tiêu đề màn back-office; back-office không dùng chữ cạnh hẹp cho tiêu đề màn.
- **Body** (400, 15–18px, 1.55–1.6): đoạn văn, tối đa 44–64ch, `text-wrap: pretty`.
- **Label** (700, 11px, 0.08em, CHỮ HOA): nhãn trường in trên vé, nhãn mốc cuống vé, nhãn dữ liệu (dt).

### Named Rules
**The No Eyebrow Rule.** Không đặt nhãn nhỏ phía trên tiêu đề. Bước của luồng ("Bước 2/3") là thông tin và dùng `.ph-step`.

## Layout

Khung khách rộng tối đa 1240px, lề ngang clamp(16px, 4vw, 40px). Màn đầu là lưới hai cột (nội dung + bảng ga | vé 580px), gộp một cột dưới 1080px; dưới 760px vé bỏ cột cuống và cuống chuyển xuống dưới thân vé. Các dải nội dung xen kẽ vật liệu (giấy in → giấy vé → bảng ga) với nhịp dọc clamp(56px, 8vw, 104px). Trang trong rộng tối đa 1120px.

Trang trong phía khách dùng `.ph-page-shell` rộng 1240px như header, footer và các dải trang chủ, nên mép trái tiêu đề thẳng với logo. Back-office: thanh bên 248px cố định, nội dung co giãn; dưới 1024px thanh bên thành ngăn kéo có nút đóng và Esc. Thanh ngữ cảnh dính đầu trang (cơ sở đang làm việc, giờ VN, người dùng, đăng xuất). Bảng dữ liệu co chữ xuống 13px và bỏ `nowrap` dưới 720px để không cuộn ngang.

## Elevation & Depth

Phẳng theo mặc định. Chiều sâu chỉ dành cho vật thể giấy nằm trên mặt bàn: tấm vé tìm phòng, vé mẫu, áp phích ga, ảnh chụp kẹp. Bảng ga và các dải là mặt phẳng.

### Shadow Vocabulary
- **Vé trên bàn** (`drop-shadow(0 1px 1px rgb(18 22 20 / .25)) drop-shadow(0 14px 26px rgb(18 22 20 / .2))`): tấm vé tìm phòng; dùng `filter` vì vé có mặt nạ khuyết.
- **Áp phích treo** (`0 18px 40px rgb(18 22 20 / .18)`): áp phích ga, kèm viền giấy 12px và xoay ±1°.
- **Ảnh kẹp** (`0 10px 22px rgb(18 22 20 / .14)`): hai ảnh nhỏ dưới mỗi ga.

### Named Rules
**The Paper Only Rule.** Chỉ vật thể bằng giấy mới có bóng. Thẻ, bảng, nút không có bóng.

## Shapes

Góc gần vuông (2–3px) cho trường và nút; vé 6px. Hình dạng nhận diện là **khuyết tròn**: vé tìm phòng khuyết trên/dưới ở đường xé giữa thân và cuống, tờ đăng nhập khuyết hai bên, mục đang mở ở thanh bên khuyết mép phải. Đường xé là nét đứt 2px mực xanh. Cuống vé có lỗ bấm tròn. Đường kẻ đôi 3px (`double`) đánh dấu đầu vé, đầu trang trong và đầu danh sách.

## Components

### Buttons
Một hình dạng, ba cỡ, bốn vai. Mọi nút dùng class `.ph-btn*` trong `globals.css`; style inline chỉ được đặt vị trí (`justifySelf`, `width`), không đặt cỡ chữ, đệm hay màu.

**Cỡ**

| Cỡ | Class | Cao tối thiểu | Đệm | Chữ | Dùng khi |
|---|---|---|---|---|---|
| Mặc định | `.ph-btn*` | 44px | 10px 18px | 14px/600 | Mọi nút |
| Lớn | `+ .ph-btn-lg` | 52px | 12px 26px | 16px/600 | Một nút cam kết đứng riêng ở cuối một bước của luồng đặt phòng (tiếp tục, giữ chỗ, thanh toán) |
| Vé | `.ph-ticket-submit` | 56px | — | Barlow 24px chữ hoa | Chỉ nút "Tìm phòng" trên tấm vé |
| Trong bảng | tự động (`td .ph-btn*`) | 44px | 10px 12px | 13px/600 | Nút hành động trong ô bảng |

Không có cỡ dưới 44px. Nút trong cùng một hàng luôn cùng cỡ (không đặt `.ph-btn-lg` cạnh nút mặc định).

**Vai**
- **Dấu bấm (`.ph-btn-accent`):** đỏ dấu bấm, chữ trắng; bước cam kết phía khách (tiếp tục đặt, giữ chỗ, thanh toán, xác nhận đổi ngày).
- **Mực in (`.ph-btn-primary`):** mực xanh, chữ trắng; hành động chính back-office, và nút tiện ích phía khách (đăng nhập, lọc đơn).
- **Viền (`.ph-btn`):** giấy in, viền #6F625C; hành động phụ (quay lại, bỏ lọc, thử lại, đăng xuất).
- **Nguy hiểm (`.ph-btn-danger`):** viền và chữ #9E1B32, hover nền đỏ; huỷ đơn, xoá, khoá tài khoản.
- Mỗi nhóm nút chỉ có một nút chính (dấu bấm hoặc mực in); nút phụ đứng trước, nút chính đứng sau.

**Trạng thái**
- **Hover:** đổi màu nền/viền 150ms. **Nhấn:** xuống 1px. **Tiêu điểm:** vòng 2px mực xanh lệch 2px (trên nền bảng ga: hổ phách).
- **Không bấm được:** nền #E9E5DF, viền #D9D2CC, chữ #5A4640 (7:1). Không làm mờ cả nút bằng `opacity`.
- **Đang xử lý:** `aria-busy="true"` đổi con trỏ sang `progress`; nhãn đổi sang dạng "Đang…".
- Nhãn dài xuống dòng trong nút (`text-wrap: balance`), không tràn khỏi nút trên màn hẹp.

**Hàng nút (`.ph-actions`)**: flex, cách nhau 12px, tự xuống dòng; `.ph-actions-end` dồn phải. Dưới 560px mỗi nút một hàng, hết chiều ngang.

### Forms (back-office)
- Hàng bộ lọc (`.ph-filter-row`): mỗi ô giãn đều 11–20rem, nút lọc đứng cuối hàng thẳng đáy ô nhập; dưới 560px mỗi ô một hàng.
- Ô nhập trong vùng làm việc không dài quá 36rem (trừ trong bảng). Select rộng tối thiểu 10rem để select rỗng không co thành mũi tên.
- Mọi điều khiển trên thanh ngữ cảnh (select cơ sở, đồng hồ, đăng xuất) cùng cao 44px.

### Ticket Fields (signature)
- **Style:** ô kẻ 1.5px mực xanh trên giấy vé, nhãn 11px chữ hoa ở trên, giá trị chữ cạnh hẹp 24px; nền trắng 38%.
- **Focus:** cả ô viền 2px mực xanh, nền trắng 70%.

### Departure Board (signature)
- Bảng đen bo 6px, đầu bảng "GA ĐẾN · GIỜ VN", mỗi ga một hàng chữ hổ phách 28px; hàng đang chọn chuyển xanh còn chỗ. Chữ lật khi tải (chỉ transform, không ẩn chữ). Nút "Chọn ga" viền hổ phách, đang chọn nền xanh.

### Fare Segments
- Mỗi đêm một ô nét đứt mực xanh: "CHẶNG n", thứ, ngày/tháng. Ở màn chi tiết phòng ô chặng in thêm giá đêm; đêm bị giữ ở sàn/trần dùng viền chấm (hình thức, không chỉ màu).

### Refund Plans
- Mỗi gói một hàng trên bảng ga; các mốc là ô có thanh trên 6px: xanh = hoàn 100%, hổ phách = 50%, đỏ đứt nét = 0%.

### Navigation
- **Khách:** dải bảng ga trên cùng, liên kết chữ hoa cạnh hẹp 17px, hover hổ phách, đồng hồ giờ VN bên phải; dưới 760px liên kết cuộn ngang một hàng.
- **Back-office:** thanh bên bảng ga, tiêu đề nhóm chữ hoa hổ phách, mục đang mở là tấm vé hồng khuyết mép phải (`aria-current="page"`). Mục điều hướng cao 40px (danh sách dày ~30 mục, cách nhau 1px; vẫn trên mức 24px của WCAG 2.5.8).

### Photo Slots
- Ảnh thật đặt theo mã ô ở `apps/customer-web/public/images/pine-hill/` (danh mục `src/content/photo-slots.ts`, brief `docs/04-thiet-ke/anh-trang-khach.md`). Thiếu ảnh: áp phích về tranh SVG, ô khác ẩn. `?anh=1` hiện khung ô ảnh.

### Content Pages (HB-310)
Trang nội dung (`/stays/[slug]`, `/room-types/[code]`) dùng đúng ba vật liệu của trang chủ, không thêm khuôn "resort editorial" (ảnh tràn màn, chữ trắng đè ảnh, hàng thẻ tiện ích có biểu tượng). Đầu trang luôn là `h1` trên nền mẫu biểu, ảnh nằm trong khung giấy.

**Station Sheet — tờ giới thiệu ga (`/stays/[slug]`)**
- **Đầu trang:** lưới hai cột trên ≥ 900px. Bên trái: đường dẫn, mã ga lớn, `h1` "Ga {tên}" cỡ Headline, loại ga, đoạn tóm tắt ≤ 60ch, nút "Xem phòng trống". Bên phải: áp phích ga (Áp phích treo, xoay −1°), ảnh LCP nên không `lazy`. Dưới 900px áp phích xuống dưới chữ, rộng tối đa 420px.
- **Bảng giờ:** một bảng ga (vật liệu bảng đen chữ hổ phách) in giờ nhận/trả phòng **lấy từ API** (`GET /public/properties`), độ cao, khí hậu, mùa đẹp. Chưa tải xong thì in "--:--", lỗi thì in "Xem ở bước tìm phòng"; không đoán giờ.
- **Sơ đồ tuyến:** dùng lại sơ đồ ba ga của trang chủ; ga đang xem có `aria-current="page"`, chấm đặc đỏ dấu bấm và nhãn đậm. Ga chưa có trang thì link về dải ga tương ứng ở trang chủ.
- **Thân trang:** đoạn kể (giấy in, ≤ 64ch), "Đến ga" (một khối giấy vé kẻ đôi đầu), gallery, các hạng phòng ở ga (dải giấy vé như trang chủ, mỗi hàng link sang trang hạng).

**Cabin Class — hạng khoang (`/room-types/[code]`)**
- **Đầu trang:** tem mã hạng lớn (nhãn dấu bấm như `RoomCodeStamp`, 2×) cạnh `h1` "Hạng {tên}" và tên khoang; đoạn tóm tắt.
- **Mặt sau vé:** thông số in như mặt sau tấm vé: khối giấy vé hồng, đầu kẻ đôi, các dòng `dt`/`dd` cách nhau bằng đường chấm (dot leader), nhãn 11px chữ hoa, giá trị chữ thân 16px. Chỉ in thông số có nguồn (sức chứa, số chỗ ngủ, có ở ga nào). **Không in diện tích, view, tiện nghi hay giá** khi chưa có dữ liệu thật; giá luôn ở bước tìm phòng, theo từng đêm.
- **Có ở ga:** hàng ga trên bảng đen nhỏ, mỗi ga một liên kết.

**Breadcrumbs**
- Một dòng 13px chữ thân mực phụ trên `h1`, ngăn bằng "›" (`aria-hidden`), trang hiện tại không là liên kết và có `aria-current="page"`. Không thay cho tiêu đề; không phải nhãn trên tiêu đề (không vi phạm The No Eyebrow Rule vì là điều hướng, không phải nhãn trang trí).

**Gallery + Lightbox**
- **Lưới:** ảnh đầu chiếm 2 cột × 2 hàng, các ảnh sau vuông góc 3px, khung giấy in 6px (Ảnh kẹp). Mỗi ảnh là một `<button>` có tên "Xem ảnh {n}/{tổng}: {alt}". 1 ảnh thì không có lưới, chỉ ảnh kẹp.
- **Lightbox:** `<dialog>` gốc mở bằng `showModal()` (khoá tiêu điểm, nền tối #121614 90%). Ảnh vừa khung, chú thích là alt + "n/tổng". Phím ← → chuyển ảnh, Esc và nút "Đóng" (44px, góc trên phải) đóng; đóng xong trả tiêu điểm về ảnh đã mở. Không tự chạy, không vuốt bắt buộc.

**Sticky Booking Stub — cuống vé dính đáy**
- Chỉ dưới 760px: dải giấy vé hồng cao 52px dính đáy màn (+ `env(safe-area-inset-bottom)`), mép trên là đường xé nét đứt mực xanh, bên trái tên ga/hạng chữ cạnh hẹp, bên phải nút dấu bấm đậm "Xem phòng trống". Trang cộng thêm đệm đáy bằng chiều cao dải để không che nội dung cuối. Trên 760px không dính: nút nằm ở đầu trang và cuối trang.
- **CTA:** chưa có ngày thì về khối tìm phòng trang chủ với ga chọn sẵn (`/?ga={slug}#search-block`); không tự bịa ngày hay tồn phòng.

## Motion

Chuyển động kể lại cơ khí của nhà ga: bảng lật, con dấu, cuống vé. Nhẹ, một lần, không giật bố cục (`apps/customer-web/src/app/motion.css`, HB-316).

**Token:** `--ph-ease-out` (0.22, 0.61, 0.36, 1) cho trượt và hover; `--ph-ease-snap` (0.34, 1.56, 0.64, 1) cho lật và đóng dấu; `--ph-dur-fast` 180ms, `--ph-dur-med` 380ms, `--ph-dur-reveal` 560ms.

- **Lật bảng ga** (`.ph-flap` khi tải, `.ph-tick` khi dữ liệu về hoặc khi chọn ga): `rotateX` một lần.
- **Đóng dấu** (`.ph-cabin-stamp`): `scale(1.22) rotate(-5deg)` → góc nghiêng của tem, một lần khi tải.
- **Mũi tên dẫn** (`.ph-arrow`, `aria-hidden`): dịch 4px khi hover/focus link.
- **Trượt khi cuộn** (`[data-reveal]`): chỉ dịch 18px, không làm mờ; JS chỉ gắn trạng thái chờ cho phần tử đang ở dưới màn hình.
- **Ảnh gallery:** phóng 3,5% trong khung cố định khi hover/focus.
- **Khung chờ dạng bảng** (`TableSkeleton`): giữ chỗ cao của bảng khi đang tải, `aria-hidden`.

### Named Rules
**The Visible-First Rule.** HTML máy chủ không ẩn gì (không `opacity: 0`, không `visibility: hidden` chờ JS). Chuyển động chỉ thêm vào sau khi trang đã đọc được.

**The Still Fold Rule.** Không animate vùng LCP (đầu trang, tấm vé, áp phích ga). Không làm mờ chữ để tạo hiệu ứng: trình quét tương phản đo theo opacity.

**The Reduced Motion Rule.** `prefers-reduced-motion: reduce` tắt mọi hoạt ảnh và chuyển tiếp mới; trượt khi cuộn không kích hoạt.

## Do's and Don'ts

### Do:
- **Do** in giá theo từng đêm (chặng) ở mọi chỗ có giá; tổng chỉ là dòng cuối.
- **Do** giữ ba vật liệu: giấy vé hồng #F0C2B3, bảng ga #121614, nền mẫu biểu #DFE5F0.
- **Do** dùng #6B2F22 và #962A16 cho chữ phụ và đỏ trên giấy vé.
- **Do** để mọi số tiền dùng `tabular-nums` và ≥ 14px.
- **Do** đặt nội dung minh hoạ trong `src/content/` và ghi rõ là để thay.
- **Do** để trang nội dung chỉ in thông số có nguồn; thiếu thì bỏ dòng, không điền cho đẹp.

### Don't:
- **Don't** đặt ảnh hero toàn màn hay thanh tìm kiếm nổi trên ảnh ở màn đầu.
- **Don't** dùng nền kem/be cho trang, hoặc xám trên nền màu.
- **Don't** dùng ảnh, font hay bố cục của thương hiệu khác (bản dựng trước từng chép Amanoi).
- **Don't** đặt nhãn nhỏ phía trên tiêu đề, gạch đầu dòng có dấu tick làm cấu trúc trang, hay hàng thẻ bằng nhau.
- **Don't** dùng chữ cạnh hẹp cho nhãn, nút và dữ liệu trong bảng ở back-office (trừ biển nhóm thanh bên và đồng hồ).
- **Don't** để lộ mã nội bộ (BR-, SCR-, HB-, F0) trong câu chữ người dùng thấy.
