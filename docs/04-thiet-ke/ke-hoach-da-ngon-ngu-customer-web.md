# Kế hoạch hỗ trợ đa ngôn ngữ cho Customer Web

**Trạng thái:** Đề xuất để lead review, chưa triển khai · **Phạm vi:** chỉ `apps/customer-web` · **Ngày:** 13/11/2026 · **Liên quan:** [Kế hoạch nội dung tĩnh](ke-hoach-noi-dung-web-tinh.md), [Thiết kế màn hình](thiet-ke-man-hinh.md), [ADR-019](adr/ADR-019-he-thong-thiet-ke-tuyen-pine-hill.md)

## 1. Mục tiêu

Phục vụ khách nước ngoài bằng sáu locale trên web khách:

| Mã | Ngôn ngữ | Ghi chú |
|---|---|---|
| `vi` | Tiếng Việt | Mặc định, giữ nguyên toàn bộ hành vi và test hiện tại |
| `en` | English | Locale hoàn chỉnh đầu tiên ngoài tiếng Việt |
| `zh-CN` | 简体中文 | Mặc định dùng Trung giản thể; `zh-TW` là quyết định riêng nếu cần |
| `ja` | 日本語 | Cần font/fallback CJK |
| `ko` | 한국어 | Cần font/fallback CJK |
| `ru` | Русский | Cần kiểm tra độ dài chuỗi và font Cyrillic |

Operations web, operations Android và customer Android giữ tiếng Việt trong phạm vi kế hoạch này.

## 2. Hiện trạng kỹ thuật

- `apps/customer-web/src/lib/i18n.ts` gộp khoảng **279 khóa câu chữ** và export singleton `t = makeTranslate(customerCatalog)`.
- `packages/ui-web/src/messages.ts` có khoảng **57 khóa dùng chung**; mặc định vẫn là `viCatalog`.
- `SCR-08` có catalog riêng khoảng **71 khóa** trong `account/messages.ts`.
- Thanh toán có catalog riêng khoảng **32 khóa** trong `pay/messages-payment.ts`.
- Root layout đặt cố định `<html lang="vi">` và truyền duy nhất `customerCatalog`.
- `format.ts` của `packages/ui-web` cố định `vi-VN`; `stamps.tsx` cố định nhãn thứ `CN, T2 … T7`.
- Nội dung tĩnh nằm trong `src/content/landing-content.ts`, `src/content/photo-slots.ts` và các trang nội dung sẽ bổ sung.
- Meta title, description, alt ảnh và nhiều thông báo đang là tiếng Việt.
- Dữ liệu động như tên cơ sở, tên hạng phòng, tên gói giá và mô tả do API trả chưa có locale.

Frontend hiện dịch được toàn bộ nhãn giao diện và nội dung tĩnh, nhưng không thể tự dịch dữ liệu API hoặc email/SMS do backend/worker gửi.

## 3. Quyết định kiến trúc đề xuất

### 3.1. Locale trên URL

Dùng tiền tố locale, ví dụ:

```text
/vi
/vi/search
/vi/rooms/synthetic-room?propertyId=...&checkIn=...
/en
/en/stays/da-lat
/ja/room-types/DLX
```

Lý do:

- Link chia sẻ giữ đúng ngôn ngữ.
- SEO có URL riêng, canonical và `hreflang` rõ ràng.
- Language switcher giữ nguyên path, query và vị trí trang.
- Dễ mở rộng sang nội dung tĩnh đa ngôn ngữ.

Mặc định `/` chuyển về `/vi` hoặc render tiếng Việt tại `/` và chỉ dùng tiền tố cho locale khác. Cần chốt một trong hai để tránh hai URL cùng nội dung.

**Đã chốt (Q2, làm ở HB-312):** `/` là tiếng Việt, locale khác có tiền tố. `apps/customer-web/src/middleware.ts` ghi đè `/en/...` về route hiện có và gắn locale vào header; không dời cây route, không tự chuyển theo `Accept-Language` (§3.2 hoãn), không nhớ lựa chọn bằng cookie.

### 3.2. Phát hiện và ghi nhớ locale

- `Accept-Language` quyết định locale lần đầu.
- Cookie lưu lựa chọn gần nhất.
- Nếu người dùng đang ở `/en/...` thì URL thắng cookie.
- Chuyển ngôn ngữ phải giữ path, query và hash nếu có.
- Không tự chuyển locale khi người dùng đang thao tác thanh toán hoặc đang giữ chỗ, tránh mất ngữ cảnh.

### 3.3. Tách catalog và translator

Cấu trúc đề xuất:

```text
apps/customer-web/src/i18n/
  locales.ts
  catalogs/
    vi.ts
    en.ts
    zh-CN.ts
    ja.ts
    ko.ts
    ru.ts
  server.ts
  account/
  payment/
```

- `Locales` và metadata locale là nguồn chân lý duy nhất.
- `customerCatalog` không còn là singleton toàn cục.
- Server component nhận translator theo locale từ request.
- Client component dùng `useTranslate()`; `I18nProvider` nhận catalog của locale hiện tại.
- Các module `messages.ts` nhỏ được đưa vào catalog theo locale hoặc giữ namespace riêng nhưng phải nhận locale.

Không dùng `localStorage` làm nguồn locale duy nhất vì server component và metadata sẽ render sai ngôn ngữ ở lần tải đầu.

## 4. Định dạng theo locale

Không thể giữ nguyên các hàm hard-code `vi-VN` cho mọi locale.

- `formatMoney`: vẫn hiển thị VND; dấu phân cách và vị trí ký hiệu có thể theo locale.
- `formatCalendarDate`, `formatDateTimeVn`: tham số locale, vẫn giữ múi giờ `Asia/Ho_Chi_Minh`.
- Nhãn thứ trong `stamps.tsx`: dùng `Intl.DateTimeFormat(locale, { weekday: 'short' })` thay cho mảng tiếng Việt.
- Khoảng thời gian giữ chỗ và đếm ngược: dịch đơn vị nhưng không đổi logic.
- Số điện thoại vẫn chuẩn hoá `+84`; chỉ dịch hướng dẫn và thông báo.
- Ngày trong `<input type="date">` phụ thuộc locale trình duyệt; nếu cần luôn `DD/MM/YYYY`, phải dùng date picker tuỳ biến.

Các thay đổi trong `packages/ui-web` phải có tham số locale mặc định `vi-VN` để operations web không đổi hành vi.

## 5. Nội dung và dữ liệu động

### Dịch ở frontend

- Toàn bộ nhãn, nút, lỗi validation, trạng thái, trợ giúp và nội dung tĩnh.
- Metadata, alt ảnh, breadcrumb, JSON-LD và thông báo UI.
- Các trang nội dung tĩnh theo [kế hoạch nội dung](ke-hoach-noi-dung-web-tinh.md).

### Không dịch được nếu chỉ sửa frontend

- Tên cơ sở, tên hạng phòng, tên gói giá và mô tả do API trả.
- Email, SMS, Zalo và thông báo do worker gửi.
- Trang thanh toán của VNPay/MoMo.
- Lỗi nghiệp vụ nếu backend chỉ trả câu tiếng Việt thay vì mã lỗi.

Đề xuất:

1. Giữ tên riêng Pine Hill và địa danh bằng tiếng Việt nếu là tên thương hiệu.
2. Dịch mô tả phòng, tiện nghi và chính sách bằng content model/API.
3. Backend nhận `Accept-Language` hoặc trả code ổn định để frontend ánh xạ sang catalog.
4. Không dùng dịch máy chưa duyệt cho điều khoản huỷ, hoàn tiền và thanh toán.

## 6. Font và layout

- Font hiện tại chỉ có subset Latin/Vietnamese; CJK và Cyrillic sẽ rơi vào fallback hệ thống.
- Phương án tối thiểu: khai báo fallback `'Noto Sans SC', 'Hiragino Sans', 'Malgun Gothic', 'Noto Sans', sans-serif` theo thứ tự.
- Phương án offline đầy đủ: đóng gói subset Noto Sans/Noto Sans CJK và font Cyrillic; cần kiểm tra dung lượng gói.
- Tiếng Nga thường dài hơn tiếng Việt: kiểm tra nút, bảng, tab, breadcrumb và card ở 360 px.
- Không dùng `text-transform: uppercase` hoặc letter-spacing quá lớn cho chuỗi CJK.
- Tất cả locale trong phạm vi này là LTR; không cần RTL.

## 7. SEO và accessibility

- `html lang` và `dir` theo locale.
- `hreflang` cho tất cả locale + `x-default`.
- Canonical theo URL locale.
- Open Graph title/description/alt theo locale.
- Language switcher có nhãn rõ, không chỉ dùng cờ; cờ không đại diện chính xác cho ngôn ngữ.
- Điều khiển ngôn ngữ dùng `<select>` hoặc menu có tên accessible.
- Giữ WCAG 2.1 AA, focus ring, thứ tự tab và vùng chạm 44 px cho mọi locale.
- Kiểm tra axe ở ít nhất `vi`, `en`, `ru`, `ja` và một chuỗi CJK dài.

## 8. Kế hoạch triển khai

1. **Chốt locale, quy tắc URL và fallback.**
2. **Tạo hạ tầng locale-aware:** catalog registry, server translator, provider, middleware/cookie.
3. **Chuyển toàn bộ component khỏi singleton `t`;** giữ tiếng Việt làm mặc định.
4. **Hoàn thiện `vi` + `en`,** bao gồm metadata, format ngày và nội dung tĩnh.
5. **Thêm `zh-CN`, `ja`, `ko`, `ru`;** duyệt thuật ngữ và QA layout/font.
6. **Phối hợp backend** cho mô tả phòng, chính sách và thông báo nếu cần bản địa hoá dữ liệu động.
7. **Bổ sung test locale, hreflang, language switch và visual regression.**

## 9. Kiểm thử và tiêu chí nghiệm thu

- Mặc định `vi` giữ nguyên toàn bộ test hiện có.
- Mỗi route truy cập được bằng cả sáu locale; không rơi về khóa thô hoặc tiếng Việt ngoài chủ đích.
- Chuyển ngôn ngữ giữ path, query, ngày, cơ sở và hạng phòng.
- `<html lang>`, canonical, `hreflang` và metadata đúng locale.
- Không tràn ngang ở 360 px với chuỗi tiếng Nga dài nhất.
- Ngày, thứ, số tiền và đếm ngược hiển thị đúng locale.
- Axe không có lỗi serious/critical ở cả sáu locale.
- Unit test, typecheck, build và E2E của customer web đạt.
- Operations web và hai app Android không đổi hành vi tiếng Việt.

## 10. Rủi ro và điểm cần lead quyết

1. Chọn `zh-CN` hay bổ sung cả `zh-TW`?
2. URL mặc định là `/` + `/en`… hay luôn có `/vi`?
3. Có cần API trả mô tả/chính sách đa ngôn ngữ trong cùng đợt hay chỉ dịch UI trước?
4. Ai duyệt bản dịch pháp lý, huỷ phòng, hoàn tiền và thanh toán?
5. Có chấp nhận font hệ thống cho CJK/Cyrillic trong bản demo hay bắt buộc đóng gói font?
6. Có cần chuyển đổi ngoại tệ không? Kế hoạch này chỉ dịch ngôn ngữ, vẫn hiển thị VND.
