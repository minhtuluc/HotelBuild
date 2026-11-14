---
id: HB-312
title: Đợt 5 frontend — locale tiếng Anh cho customer web (/en/...), chọn ngôn ngữ, hreflang, định dạng tiền/ngày theo locale
risk: R1
owner: claude
max_lines: 4000
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr82-tieng-anh.spec.ts
  - DESIGN.md
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/04-thiet-ke/ke-hoach-da-ngon-ngu-customer-web.md
  - docs/08-thi-cong/tickets/HB-312-locale-en.md
unlock:
  - docs/08-thi-cong/tickets/HB-312-locale-en.md
---

# HB-312 — Đợt 5 frontend: tiếng Anh

> Đặc tả do frontend lead soạn theo đợt 5 [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (quyết định Q2, Q6, Q16) và [kế hoạch đa ngôn ngữ](../../04-thiet-ke/ke-hoach-da-ngon-ngu-customer-web.md). Dựng trên nền i18n của HB-309. Chồng trên HB-316 (#307).

## Vấn đề

Customer web chỉ có tiếng Việt. Khách nước ngoài không đọc được trang chủ, luồng đặt phòng hay trang nội dung. Nền i18n (HB-309) đã sẵn, nhưng chưa có locale thứ hai, URL theo locale hay cách chọn ngôn ngữ.

## Thay đổi

1. **URL** (Q2):
   - `/` và mọi đường dẫn hiện có là tiếng Việt; tiếng Anh là `/en/...`.
   - `middleware.ts` ghi đè (rewrite) `/en/x` sang route `x` hiện có và gắn header `x-ph-locale`, `x-ph-path`, không dời cây route.
   - Header gửi từ trình duyệt bị ghi đè, không tin.
   - Bỏ qua `/api`, `/_next`, tệp tĩnh.
2. **Locale phía máy chủ:**
   - `requestLocale()` đọc header (async theo Next 15); `serverTranslators()` thành async.
   - Server component và metadata `await`.
   - `html lang` theo locale.
3. **Link nội bộ:**
   - `localizePath(path, locale)` (máy chủ) và `useLocalePath()` (client) thêm `/en` khi đang ở tiếng Anh.
   - Mọi `href`, `router.push`, `redirect` nội bộ đi qua hai hàm này.
   - Gọi API BFF (`/api/session/...`) không đổi.
4. **Chọn ngôn ngữ:**
   - `<select>` có nhãn ("Ngôn ngữ / Language") ở header, không dùng cờ.
   - Đổi thì sang cùng đường dẫn và tham số ở locale kia.
5. **SEO:**
   - `alternates.languages` (`vi`, `en`, `x-default` → bản không tiền tố) và canonical theo locale cho mọi trang.
   - `og:locale`.
6. **Định dạng theo locale:**
   - `money(amount, locale)` nối vào mọi chỗ in tiền ở customer web (hook `useMoney`).
   - Giờ VN (`dateTimeVn(iso, locale)`) thay `formatDateTimeVn` của `ui-web` ở customer web.
   - `en` dùng thẻ `en-GB` (ngày trước tháng: `24/12/2026`, thứ `Thu`); tiền vẫn là VND số nguyên (`1,222,000 ₫`).
7. **Danh mục `en`:**
   - `customer`, `account`, `payment`, `content` đủ khoá (kiểu `Record` bắt thiếu).
   - Nội dung tĩnh `landingContent`, trang ga/hạng, alt ảnh có bản `en`.
   - Bản dịch do frontend soạn cho demo (Q6). Các khoá về huỷ, hoàn, thanh toán, chính sách liệt kê ở `EN_NEEDS_REVIEW` để duyệt trước ngày phát hành công khai.

## Tiêu chí nghiệm thu

1. Unit:
   - `catalogs.spec.ts`: mọi locale đủ khoá, không câu rỗng; mọi khoá trong `EN_NEEDS_REVIEW` có thật.
   - Định dạng `en` (ngày, thứ, tiền).
   - `localizePath` (thêm/bỏ tiền tố, giữ query và hash, không đụng `/api`).
2. E2E `tests/e2e/scr82-tieng-anh.spec.ts`:
   - `/en`: `html lang="en"`, tiêu đề tiếng Anh, link nội bộ giữ `/en`, hreflang đủ ba mục.
   - Chọn ngôn ngữ chuyển qua lại giữ đường dẫn.
   - Tìm phòng từ `/en` sang kết quả `/en/search?...` có tiền theo `en`.
   - `/en/stays/da-lat`, `/en/room-types/DLX` hiện nội dung tiếng Anh.
   - axe không có lỗi serious/critical; 360 px không cuộn ngang.
3. Toàn bộ E2E customer-web hiện có đạt: tiếng Việt không đổi.
4. Typecheck, lint đạt; không có cast `as` mới.

## Ngoài phạm vi

- Tự chuyển locale theo `Accept-Language`, nhớ lựa chọn bằng cookie: không làm, để URL ổn định.
- Locale `zh-CN`, `ja`, `ko`, `ru` (HB-313).
- Dữ liệu động do API trả (tên cơ sở, tên gói giá, thông điệp lỗi máy chủ) vẫn theo ngôn ngữ của API.
