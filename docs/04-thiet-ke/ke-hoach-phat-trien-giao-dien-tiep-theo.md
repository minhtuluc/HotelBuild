# Kế hoạch phát triển giao diện frontend sau PR #298

**Trạng thái:** Đã chốt (frontend lead, 13/11/2026); quyết định ở §6 · **Ngày:** 13/11/2026 · **Phạm vi:** `apps/customer-web`, `apps/operations-web`, `packages/ui-web` · **Liên quan:** [Kế hoạch nội dung tĩnh](ke-hoach-noi-dung-web-tinh.md), [Kế hoạch đa ngôn ngữ](ke-hoach-da-ngon-ngu-customer-web.md), [ADR-019](adr/ADR-019-he-thong-thiet-ke-tuyen-pine-hill.md), [DESIGN.md](../../DESIGN.md), [Sổ nợ kỹ thuật](../07-ban-giao/no-ky-thuat.md), [Ảnh trang khách](anh-trang-khach.md)

Tài liệu này ghép hai hướng PR #298 đã đặt ra (nội dung tĩnh, đa ngôn ngữ) với các việc frontend mà backend vừa mở khoá trên `main`, rồi xếp thành các đợt có thứ tự phụ thuộc.

## 1. Hiện trạng trên `main` (1c6dbae)

**Đã có**

- Hệ thống thiết kế "Tuyến Pine Hill" (ADR-019, `DESIGN.md`): token chung, ba vật liệu, thang nút 44/52/56 px, hàng nút và hàng bộ lọc chuẩn.
- Customer web: 13 màn nghiệp vụ (SCR-01…13) và trang chủ dạng cuộn (ga, hạng phòng, giá theo chặng, bảng trả vé, bốn bước, hỏi nhanh).
- 15 ảnh minh hoạ theo ô ảnh. Cách ghép: 10 ảnh Amanoi, 4 ảnh Wikimedia (CC BY/BY-SA), 1 ảnh Pexels.
- Operations web đã khoác thế giới vé tàu: thanh bên bảng ga, tờ đăng nhập dạng vé, đồng hồ giờ VN.

**Backend vừa mở khoá, frontend chưa nối**

| Nợ | API đã có | Màn chờ nối | Hiện trạng màn |
|---|---|---|---|
| TD-09 | `GET /operations/day-board` (HB-242), `api-client.dayBoard` | SCR-23 Bảng điều khiển ngày | Vẫn hiện khối "Các dữ liệu chưa hỗ trợ" cho đến/đi/ở, ca quá tải, kênh suy giảm |
| TD-06 | `PUT /seasons/{seasonId}` (HB-241), `api-client.updateSeason` | SCR-27 Mùa & hệ số | Chỉ tạo và xem, chưa sửa hoặc ngừng được |
| TD-08 | `PUT /promotions/{promotionId}` (HB-240), `api-client.updatePromotion` | SCR-29 Khuyến mãi | Chỉ tạo và xem, chưa sửa hoặc ngừng được |

**Nợ frontend còn mở**

- **TD-44:** các màn ops cũ chưa dùng `useWorkingProperty()` (mới có Bàn tiền sảnh).
- **TD-42, TD-41:** trạng thái đăng nhập khách chỉ có ở `/account/*`; `web-session` chưa phủ đăng ký và đặt lại mật khẩu.
- **Ngày trong `<input type="date">`** hiển thị theo locale trình duyệt (`mm/dd/yyyy` trên máy cài tiếng Anh).
- **API công khai** chưa có ảnh, mô tả, tiện nghi theo cơ sở và hạng phòng ([YEU-CAU §5](../../YEU-CAU-API-TU-FRONTEND.md)).

## 2. Vấn đề còn tồn

**Hoãn tới ngày phát hành công khai.** Bản hiện tại là demo cho khách, không phát hành. Theo chủ dự án, các mục sau tạm bỏ qua và **phải rà lại trước khi deploy rộng rãi**:

- **Bản quyền ảnh:** 10 ảnh Amanoi không có giấy phép tái sử dụng (trái lý do loại bản Amanoi ghi trong ADR-019); 4 ảnh Wikimedia CC BY/BY-SA chưa hiện ghi công trên trang.
- **Nội dung minh hoạ:** mô tả ga, hạng phòng và các trang nội dung mới là minh hoạ, chưa phải thông tin thật của Pine Hill.
- **Bản dịch:** câu chữ pháp lý (huỷ, hoàn, thanh toán) ở các locale mới chưa có người duyệt.

Trong lúc demo, mọi dữ liệu minh hoạ vẫn mang cờ (`illustrative`, `license`) trong `src/content/`, nhưng **trang không hiện nhãn "minh hoạ"** để bản demo trông hoàn chỉnh.

**Xử lý trong các đợt**

| # | Vấn đề | Xử lý |
|---|---|---|
| P1 | E2E SCR-07 (3 ca) đỏ khi chạy trên dev server: API trả 401 ngay sau khi tạo booking thành công | Chạy lại bằng cấu hình chuẩn (build + `next start`) ở đợt 1; lỗi thật thì sửa trong đợt |
| P2 | E2E SCR-12 khoá câu "hợp đồng chưa có trường này…", câu kỹ thuật hiện thẳng cho khách | Đổi ở đợt 2 khi chuyển câu chữ sang catalog: ticket HB-309 ghi rõ việc đổi assertion và lý do, test khoá mới được ghim lại theo quy trình của AGENTS.md |
| P3 | Ticket HB-300 và HB-305 trên `main` vẫn mô tả hướng Lyon/Amanoi Editorial | Không sửa đặc tả cũ; ticket mới (HB-308+) dẫn chiếu ADR-019 và DESIGN.md |

## 3. Thứ tự đề xuất và lý do

```mermaid
flowchart LR
  D1["Đợt 1<br/>Nối API back-office<br/>+ gỡ nhãn minh hoạ khỏi trang demo"] --> D2["Đợt 2<br/>Nền tảng i18n (chỉ vi)"]
  D2 --> D3["Đợt 3<br/>Trang nội dung mẫu<br/>1 cơ sở + 1 hạng phòng"]
  D3 --> D4["Đợt 4<br/>Nhân nội dung<br/>3 cơ sở, 5 hạng, 5 trang chuỗi"]
  D2 --> D5["Đợt 5<br/>Tiếng Anh"]
  D4 --> D6["Đợt 6<br/>zh-CN, ja, ko, ru"]
  D5 --> D6
```

- **Đợt 1 làm ngay.** API đã có và giá trị dùng hằng ngày cho lễ tân và quản lý là cao nhất; cũng là phần back-office còn trống rõ nhất khi demo.
- **i18n trước nội dung tĩnh.** Nếu dựng 13 trang nội dung bằng chuỗi tiếng Việt viết trong JSX rồi mới tách catalog, toàn bộ trang phải viết lại lần hai. Route nội dung cũng phụ thuộc quyết định URL locale (`/stays/da-lat` hay `/vi/stays/da-lat`).
- **Một trang mẫu trước khi nhân bản.** Trang cơ sở và trang hạng phòng là hai khuôn mới cho thế giới vé tàu. Chốt khuôn trên một trang, đo a11y và hiệu năng ảnh, rồi mới nhân ra 8 trang.

## 4. Các đợt

### Đợt 0 — Gỡ nhãn minh hoạ khỏi trang demo (gộp vào PR đầu của đợt 1)

- Bỏ dòng "Toàn bộ ảnh và mô tả … là minh hoạ" ở trang chủ và hậu tố "ảnh minh hoạ" trong `alt`; `alt` chỉ tả nội dung ảnh.
- Thêm trường `illustrative`/`license` cho từng ô ảnh trong `photo-slots.ts` để rà lại trước ngày phát hành công khai (§2).

### Đợt 1 — Nối API mới cho back-office

| Màn | Việc | Ghi chú thiết kế |
|---|---|---|
| SCR-23 Bảng điều khiển ngày | Thay khối "chưa hỗ trợ" bằng 3 cột đến / đang ở / đi, danh sách ca quá tải mở (link sang SCR-43), kênh `DEGRADED` (link sang SCR-41) | Bảng thẳng cột, số `tabular-nums`. Đây là màn duy nhất ở back-office được dùng hàng bảng ga (chữ hổ phách trên nền đen) cho tiêu đề ba cột, vì nó đúng nghĩa là "bảng giờ trong ngày". HOUSEKEEPING không có quyền: giữ màn cấm truy cập hiện có |
| SCR-27 Mùa & hệ số | Sửa và ngừng mùa: `If-Match` theo `version`, ô lý do bắt buộc, xử lý 409/412 bằng khối "dữ liệu đã đổi, tải lại" | Hộp thoại xác nhận ngừng dùng `.ph-btn-danger` |
| SCR-29 Khuyến mãi | Sửa và tắt sớm: hiện `usedCount`, các bước giống SCR-27 | Không tự tính giá sau giảm ở frontend |
| TD-44 | Chuyển các màn ops còn tự lấy `propertyId` sang `useWorkingProperty()` | Bỏ select "Cơ sở" lặp lại trên từng màn, chỉ để lại ở thanh ngữ cảnh |

Mỗi màn có unit test cho model, E2E trên API giả và axe.

### Đợt 2 — Nền tảng i18n, chỉ tiếng Việt (bước 2–3 của kế hoạch đa ngôn ngữ)

- **Cấu trúc thư mục:** `src/i18n/` gồm `locales.ts`, `catalogs/vi.ts`, translator phía server và provider phía client. Gộp `account/messages.ts` và `pay/messages-payment.ts` vào namespace.
- **Bỏ singleton `t`.** Server component nhận translator theo request.
- **Định dạng theo locale:** `formatMoney`, `formatCalendarDate`, nhãn thứ trong `stamps.tsx` nhận tham số locale, mặc định `vi-VN` để operations web không đổi.
- **Nội dung tĩnh hiện có** (`landing-content.ts`, `photo-slots.ts`) chuyển sang dạng khoá theo locale.
- **Ô ngày:** giữ `<input type="date">` gốc (bàn phím, trình đọc màn hình và bộ chọn ngày của điện thoại đều dùng tốt). Ngay dưới ô hiện ngày đã định dạng theo locale (vd. "T5, 24/12/2026"), để khách luôn thấy đúng ngày dù trình duyệt hiển thị `mm/dd/yyyy`.
- **Test khoá SCR-12:** đổi assertion sang câu cho khách (P2).
- **Nghiệm thu:** mọi test hiện có xanh, không đổi giao diện tiếng Việt (so ảnh chụp trước/sau).

### Đợt 3 — Trang nội dung mẫu

- **Hai trang:** `/stays/da-lat` và `/room-types/DLX`, dựng theo §3–§5 của kế hoạch nội dung tĩnh.
- **Bổ sung DESIGN.md trước khi dựng.** Bốn component mới cần quy tắc riêng để không thành khuôn "resort editorial" chung chung:
  - Trang cơ sở là **"tờ giới thiệu ga"**: áp phích ga làm đầu trang, bảng giờ nhận/trả phòng, sơ đồ tuyến đánh dấu ga đang xem.
  - Trang hạng phòng là **"hạng khoang"**: nhãn mã hạng, bảng thông số in như mặt sau vé.
  - `GalleryGrid` có lightbox dùng được bằng bàn phím.
  - `StickyBookingCta` trên điện thoại là cuống vé dính đáy màn, cao 52 px, không che nội dung cuối trang.
- **CTA sang luồng đặt phòng:** khi chưa có ngày, đưa về khối tìm phòng có chọn sẵn ga; khi có ngày, sang SCR-03.
- **Metadata:** canonical, Open Graph, JSON-LD `Hotel`, `HotelRoom`, `BreadcrumbList`.
- **Nghiệm thu:** axe 0 lỗi serious/critical, không cuộn ngang ở 360 px, LCP ảnh đầu trang dưới 2,5 s trên cấu hình Lighthouse mobile, `impeccable detect` 0 lỗi.

### Đợt 4 — Nhân nội dung

- 3 trang cơ sở, 5 trang hạng phòng dùng chung, 5 trang cấp chuỗi (gallery, dining, experiences, offers, getting-here).
- Header thêm nhóm "Khám phá" (Ga, Hạng phòng, Ưu đãi); trên điện thoại gộp vào một menu.
- Nội dung chưa có nguồn thật đánh dấu `illustrative: true` và hiện ghi chú; không đưa số liệu, giải thưởng hay tiện nghi bịa.

### Đợt 5 — Tiếng Anh

- URL locale theo quyết định của lead; nút chọn ngôn ngữ là `<select>` có nhãn, không dùng cờ.
- Thêm `hreflang`, `html lang` theo locale, metadata tiếng Anh.
- Nối `money(amount, locale)` (`src/i18n/format.ts`) vào các màn còn gọi `formatMoney` mặc định `vi-VN`: HB-309 đã cho hàm nhận locale nhưng chưa đổi từng chỗ gọi vì chỉ có `vi`.
- Bản demo dùng bản dịch do frontend soạn; câu chữ về huỷ, hoàn tiền và thanh toán được đánh dấu cần duyệt trước ngày phát hành công khai (§2).

### Đợt 6 — zh-CN, ja, ko, ru

- **Font:** Barlow Condensed không có glyph CJK. Các chỗ dùng chữ cạnh hẹp viết hoa (bảng ga, biển ga, nút "Tìm phòng") cần quy tắc thay thế cho CJK: font Noto Sans CJK, không viết hoa, không giãn chữ. Ghi quy tắc này vào DESIGN.md ở đợt 2 để component chuẩn bị sẵn.
- **Tiếng Nga dài hơn:** kiểm nút, bảng ga và cuống vé ở 360 px.

## 5. Ticket

| Ticket | Đợt | Nội dung | Trạng thái | Phụ thuộc |
|---|---|---|---|---|
| [HB-308](../08-thi-cong/tickets/HB-308-dot-1-back-office-api-moi.md) | 0 + 1 | SCR-23 bảng ngày, SCR-27 sửa/ngừng mùa, SCR-29 sửa/tắt khuyến mãi, TD-44 cho SCR-23/27, gỡ nhãn minh hoạ trang demo | PR [#302](https://github.com/minhtuluc/HotelBuild/pull/302) | — |
| [HB-309](../08-thi-cong/tickets/HB-309-nen-tang-i18n-customer-web.md) | 2 | Nền tảng i18n customer web (chỉ `vi`), định dạng theo locale, dòng ngày dưới ô ngày, đổi câu phí đổi ngày SCR-12, sửa lỗi phiên khi chạy dev | Đang làm | HB-308 (cùng sửa danh mục khách) |
| [HB-310](../08-thi-cong/tickets/HB-310-trang-noi-dung-mau.md) | 3 | Trang cơ sở và trang hạng phòng mẫu + mục DESIGN.md mới | Đang làm | HB-309 |
| HB-311 | 4 | Nhân nội dung 3 + 5 + 5 trang | Chưa mở | HB-310 |
| HB-312 | 5 | Locale `en` | Chưa mở | HB-309 |
| HB-313 | 6 | Locale `zh-CN`, `ja`, `ko`, `ru` + font | Chưa mở | HB-312 |
| HB-315 | — | E2E SCR-48 bàn tiền sảnh xanh lại sau #298 | PR [#303](https://github.com/minhtuluc/HotelBuild/pull/303) | — |
| HB-314 | — | TD-44 cho các màn vận hành còn lại (lưới tồn, lịch giá, danh sách booking, báo cáo, kênh, người dùng, hạng phòng, SCR-40/43/47) | Chưa mở | HB-308 |

E2E SCR-07 (P1) được kiểm lại trong HB-308.

Việc cần backend, đề xuất gửi song song qua [YEU-CAU-API-TU-FRONTEND.md](../../YEU-CAU-API-TU-FRONTEND.md):

- Ảnh, mô tả, tiện nghi, diện tích theo cơ sở × hạng phòng trong API công khai (đã ghi §5).
- Nhận `Accept-Language` hoặc trả mã ổn định cho tên gói giá, chính sách và lỗi nghiệp vụ.

## 6. Quyết định của frontend lead

| # | Câu hỏi | Quyết định | Lý do |
|---|---|---|---|
| Q1 | Bản quyền ảnh, nội dung minh hoạ | Bỏ qua cho demo; trang không hiện nhãn minh hoạ; rà lại trước ngày phát hành công khai | Chủ dự án quyết định: demo không phát hành, nhãn tạm làm hỏng buổi demo |
| Q2 | URL locale | `/` là tiếng Việt; locale khác có tiền tố (`/en/...`, `/ja/...`); `x-default` trỏ `/` | Không đổi URL đang chạy, link đã chia sẻ và ~100 E2E hiện có; tiếng Việt vẫn là thị trường chính |
| Q3 | 5 hay 15 trang hạng phòng | 5 trang dùng chung toàn chuỗi | API chưa có dữ liệu theo cơ sở; 15 trang minh hoạ chỉ là 5 trang chép ba lần |
| Q4 | Nhóm trang nội dung làm trước | Trang cơ sở (`/stays/[slug]`) | Nối thẳng vào khối tìm phòng (chọn sẵn ga) và dùng lại áp phích, ảnh ga đã có |
| Q5 | Tiếng Trung | Chỉ `zh-CN` | Khách Trung Quốc đại lục là nhóm chính; `zh-TW` thêm sau nếu có nhu cầu |
| Q6 | Duyệt bản dịch pháp lý | Demo dùng bản dịch do frontend soạn, đánh dấu cần duyệt | Không chặn demo; duyệt trước ngày phát hành công khai |
| Q7 | Test khoá SCR-12 có câu kỹ thuật | Đổi trong HB-309 theo quy trình ghim test khoá | Khách không nên đọc "hợp đồng chưa có trường này" |
| Q8 | Ô ngày theo locale | Giữ ô ngày gốc + dòng ngày đã định dạng bên dưới | Bộ chọn ngày tự viết khó đạt a11y và trải nghiệm điện thoại bằng bộ chọn gốc |
| Q9 | Font CJK, Cyrillic | Dùng font hệ thống (Noto Sans CJK, Hiragino, Malgun Gothic) làm fallback, chưa đóng gói | Đủ cho demo, tránh tăng dung lượng; đóng gói nếu QA thấy lỗi hiển thị |
| Q10 | Thứ tự | Đợt 1 → 2 → 3 → 4, tiếng Anh (đợt 5) làm ngay sau đợt 2 song song với nội dung | Đợt 1 không phụ thuộc gì; i18n trước nội dung để không viết lại trang |

## 7. Tiêu chí chung cho mọi đợt

- Theo `DESIGN.md`: ba vật liệu, thang nút, không nhãn nhỏ trên tiêu đề, không nền kem.
- Không tự tính giá, tồn hay chính sách ở frontend.
- Typecheck, lint, unit test, E2E liên quan, axe (WCAG 2.1 AA) và `impeccable detect` 0 lỗi trên trang đã đổi.
- Không cuộn ngang ở 360 px; vùng chạm ≥ 44 px.
- Operations web và hai app Android không đổi hành vi khi `customer-web` thêm locale.
