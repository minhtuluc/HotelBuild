---
id: HB-249
title: App khách Android dùng được từ đầu — mở vào tìm phòng, chọn cơ sở theo tên, đăng nhập là màn riêng, tiêu đề thật, hết vòng tải lặp
risk: R1
owner: claude
max_lines: 650
allow:
  - apps/customer-android/app/**
  - apps/customer-android/src/**
  - apps/customer-android/test/**
  - docs/08-thi-cong/tickets/HB-249-dieu-huong-app-khach.md
unlock:
  - docs/08-thi-cong/tickets/HB-249-dieu-huong-app-khach.md
---

# HB-249 — Điều hướng app khách Android

> Đặc tả do Claude soạn ngày 17/11/2026 từ lần chạy máy thật (OnePlus PLQ110, Android 16). Chồng trên HB-248.

## Vấn đề (quan sát trên máy thật)

1. Đăng nhập xong, màn chính chỉ có nút **Đăng xuất**. Các tab Tìm phòng / Đơn của tôi / Tài khoản không có đường vào (chỉ mở được bằng deep link). Khách cũng phải đăng nhập trước khi được xem phòng.
2. Ô "Cơ sở (mã)" bắt khách gõ mã như `CS-01`, nhưng `GET /inventory/availability` cần id cơ sở, nên tìm phòng luôn trả `E_GEN_VALIDATION_FAILED`.
3. Header hiện tên file route (`index`, `(tabs)`); tab hiện ký tự `⏷` thay cho icon.
4. Mở "Chi tiết & giá" làm app treo: `useLocalSearchParams()` trả object mới mỗi lần render. Màn chi tiết phòng dùng nó làm dependency nên `load` → `setState` → render → `load`… Hơn 7.000 request `rate-plans`/`quotes` trong vài phút, luồng JS chạy 93% CPU. Màn xác nhận giữ chỗ có cùng mẫu.
5. Giữ chỗ luôn bị 409 `E_RATE_QUOTE_MISMATCH`: báo giá ở màn chi tiết phòng lấy bằng client công khai (chủ thể ẩn danh), còn giữ chỗ gửi token của khách. API chỉ cho chính chủ thể tiêu thụ báo giá. Bản web đã xin lại giá trong phiên ở màn xác nhận. Kèm theo: `submit` thiếu `hold` trong dependency nên thử lại sau lỗi đặt phòng có thể giữ chỗ lần hai.

## Thay đổi

1. `/` chuyển thẳng sang `/search`. Màn đăng nhập/đăng ký chuyển sang route riêng `/login`, xong thì quay lại màn đã mở nó. `LoginPrompt` dùng chung cho tab Tài khoản, tab Đơn của tôi và bước giữ chỗ. Tab Tài khoản có nút Đăng xuất. Hai tab kiểm lại phiên mỗi lần được mở (`useFocusEffect`).
2. `PropertyPicker` lấy danh sách từ `GET /public/properties` (client công khai, không token) và hiện theo tên; mặc định chọn cơ sở đầu.
3. `SCREEN_TITLES` ánh xạ mọi route sang khoá catalog; Stack gốc đặt tiêu đề theo bảng này. Thanh tab chỉ hiện chữ.
4. `useStableSearchParams` trả tham số ổn định theo nội dung; màn chi tiết phòng và màn xác nhận dùng hook này.
5. `startHold` xin lại báo giá bằng client có phiên (`quoteRequestFor`) rồi giữ chỗ và đặt phòng bằng mã báo giá mới; màn xác nhận dùng lại chỗ giữ + mã báo giá khi thử lại bước đặt phòng.

## Tiêu chí nghiệm thu

1. Mọi route trong `app/` có tiêu đề trong catalog; `/` chuyển sang `/search`; các màn cần tài khoản dùng `LoginPrompt` → `/login` — test: `test/routes.spec.ts`
2. Danh sách cơ sở đọc `GET /public/properties` không gửi `Authorization` — test: `test/public-client.spec.ts`
3. Chọn cơ sở mặc định/giữ lựa chọn — test: `test/properties.spec.ts`
4. Khoá tham số theo nội dung; không màn nào dùng tham số thô làm dependency — test: `test/stable-params.spec.ts`
5. Giữ chỗ xin lại báo giá trong phiên và dùng mã mới — test: `test/hold.spec.ts`
6. Máy thật: mở app vào Tìm phòng → chọn cơ sở theo tên → có kết quả → mở chi tiết phòng (2 request, không lặp) → giữ chỗ & đặt phòng tạo booking → Đăng xuất ở tab Tài khoản → lời nhắc đăng nhập → đăng nhập → quay lại tab Đơn của tôi thấy booking.

## Ngoài phạm vi

- Ô ngày vẫn gõ `YYYY-MM-DD` (ticket chọn ngày riêng).
- Bộ icon cho tab.
- Tab Tài khoản báo `E_RBAC_FORBIDDEN`: API chưa cài `GET /guests/me` và `/guests/me/loyalty` (có trong OpenAPI); request rơi vào tuyến nhân viên `/guests/:guestId` — ticket backend riêng.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
