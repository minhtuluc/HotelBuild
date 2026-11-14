---
id: HB-309
title: Đợt 2 frontend — nền tảng i18n customer web (chỉ vi), định dạng theo locale, dòng ngày dưới ô ngày, câu phí đổi ngày SCR-12 cho khách
risk: R1
owner: claude
max_lines: 3500
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - packages/ui-web/src/format.ts
  - packages/ui-web/test/**
  - tests/e2e/scr12-doi-ngay-web.spec.ts
  - tests/e2e/scr01-tim-phong.spec.ts
  - DESIGN.md
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/04-thiet-ke/ke-hoach-da-ngon-ngu-customer-web.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-309-nen-tang-i18n-customer-web.md
unlock:
  - docs/08-thi-cong/tickets/HB-309-nen-tang-i18n-customer-web.md
---

# HB-309 — Đợt 2 frontend: nền tảng i18n customer web

> Đặc tả do frontend lead soạn theo [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (đợt 2) và bước 2–3 của [kế hoạch đa ngôn ngữ](../../04-thiet-ke/ke-hoach-da-ngon-ngu-customer-web.md). Chồng trên HB-308 (cùng sửa `apps/customer-web/src/lib/i18n.ts`).

## Vấn đề

- Customer web dùng singleton `t` gắn cứng danh mục tiếng Việt. Hai màn (SCR-08 tài khoản, SCR-06 thanh toán) tự khai báo danh mục riêng. Server component, metadata và client component không có chỗ nào nhận locale.
- Định dạng tiền, ngày lịch và nhãn thứ viết cứng theo `vi-VN`.
- Nội dung tĩnh trang chủ (`landing-content.ts`, `photo-slots.ts`) là chuỗi tiếng Việt không theo locale.
- Ô ngày `<input type="date">` hiện theo locale trình duyệt (có máy hiện `mm/dd/yyyy`): khách không chắc mình đã chọn đúng ngày.
- SCR-12 hiện cho khách câu kỹ thuật "hợp đồng chưa có trường này" (vấn đề P2 trong kế hoạch).

## Thay đổi

1. **`src/i18n/`** là nguồn chân lý về locale:
   - `locales.ts`: `LOCALES` (đợt này chỉ `vi`), `DEFAULT_LOCALE`, thẻ `Intl`, `html lang`.
   - `catalogs/vi/{customer,account,payment}.ts`: danh mục tiếng Việt, chuyển nguyên văn từ `lib/i18n.ts`, `account/messages.ts`, `pay/messages-payment.ts`.
   - `catalogs/index.ts`: registry theo locale. Locale mới phải đủ khoá (kiểm bằng kiểu).
   - `translate.ts`: `translatorsFor(locale)`, thuần, dùng được ở cả server lẫn client.
   - `server.ts`: `requestLocale()`. Đợt này luôn trả `vi`; đợt 5 sẽ đọc từ URL.
   - `client.tsx`: `LocaleProvider`, `useLocale`, `useT`, `useAccountText`, `usePaymentText`.
2. **Bỏ singleton `t` và `accountText`/`paymentText` toàn cục:**
   - Client component lấy translator qua hook; hàm phụ nhận translator làm tham số.
   - Server component và metadata lấy translator theo `requestLocale()`.
3. **Định dạng theo locale** (`src/i18n/format.ts`, `packages/ui-web/src/format.ts`):
   - `formatMoney(amount, locale?)`: mặc định `vi-VN`, nên operations web không đổi.
   - Ngày lịch, nhãn thứ trên tem đêm, dòng ngày đầy đủ: `vi` giữ nguyên đầu ra hiện tại (`dd/MM/yyyy`, `CN`/`T2`…).
   - Câu kỳ lưu trú (`stayText`) lấy câu "n đêm · người lớn · trẻ em" từ danh mục của locale; bốn màn ghép tay `formatStaySpan` + `formatStayPeriod` chuyển sang `stayText`.
   - Các chỗ gọi `formatMoney` trong màn khách vẫn dùng mặc định `vi-VN`; nối `money(amount, locale)` khi có locale thứ hai (HB-312).
4. **Nội dung tĩnh theo locale:** `landingContent(locale)`, `photoAlt(slot, locale)`. Tiếng Việt giữ nguyên văn.
5. **Dòng ngày dưới ô ngày** (SCR-01 tìm phòng, SCR-12 đổi ngày):
   - Giữ `<input type="date">` gốc.
   - Ngay dưới ô in ngày đã định dạng theo locale (vd. "T5, 24/12/2026"), nối với ô qua `aria-describedby`.
6. **Câu phí đổi ngày SCR-12:**
   - Thay "hợp đồng chưa có trường này — máy chủ giữ cam kết cũ (BR-BOOK-12)…" bằng câu cho khách: phí (nếu có) theo chính sách gói đã chọn, cơ sở xác nhận trước khi áp dụng.
   - Assertion E2E `scr12-doi-ngay-web.spec.ts` đổi theo câu mới. Test này không bị khoá ở HB-104; lý do đổi ghi ở đây và trong PR.
   - Không thêm quy tắc phí ở frontend.
7. **Lỗi phiên khi chạy dev** (React StrictMode) ở SCR-04/05 và SCR-07: phiên tạo trong `useMemo` bị huỷ ở cleanup rồi dùng lại (bản production không bị). Hook `useGuestSession` hẹn huỷ sang nhịp sau và bỏ hẹn khi effect chạy lại; dùng cho SCR-04/05, SCR-07, SCR-09 và SCR-10 (hai màn sau trước đây không huỷ phiên).

## Tiêu chí nghiệm thu

1. Unit test mới:
   - `test/i18n/catalogs.spec.ts`: mọi locale đủ khoá, không khoá rỗng.
   - `test/i18n/format.spec.ts`: ngày, thứ, tiền theo `vi` giữ đầu ra cũ.
   - E2E `scr01-tim-phong.spec.ts`: dòng ngày "T5, 24/12/2026" và mô tả truy cập của ô.
   - Toàn bộ unit customer-web và ui-web đạt.
2. Không còn import `t` singleton, `accountText`, `paymentText` toàn cục trong `src/` (kiểm bằng test quét nguồn).
3. E2E customer-web hiện có đạt; giao diện tiếng Việt không đổi (ảnh chụp trước/sau ở 1440 px và 360 px của trang chủ, kết quả, chi tiết phòng, đặt phòng, đơn của tôi).
4. Dòng ngày dưới ô ngày có `aria-describedby`; axe không có lỗi serious/critical; không cuộn ngang ở 360 px.
5. Typecheck, lint (`complexity`, `max-lines`) đạt; không có cast `as` mới.

## Ngoài phạm vi

- URL theo locale, middleware, cookie và nút chọn ngôn ngữ (đợt 5, HB-312).
- Bản dịch locale khác `vi`.
- Operations web (vẫn dùng `vi-VN` mặc định).
