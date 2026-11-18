---
id: HB-252
title: App vận hành Android — header có tiêu đề thật, nút Back không thoát app giữa chừng, giao diện sáng giữ nguyên khi máy để chế độ tối
risk: R1
owner: claude
max_lines: 400
allow:
  - apps/operations-android/app/_layout.tsx
  - apps/operations-android/app/index.tsx
  - apps/operations-android/src/stages.ts
  - apps/operations-android/src/strings.ts
  - apps/operations-android/test/screen-titles.spec.ts
  - apps/operations-android/package.json
  - apps/customer-android/package.json
  - pnpm-lock.yaml
  - docs/08-thi-cong/tickets/HB-252-tieu-de-app-van-hanh.md
unlock:
  - docs/08-thi-cong/tickets/HB-252-tieu-de-app-van-hanh.md
---

# HB-252 — Tiêu đề, nút Back và chế độ tối của app vận hành

> Đặc tả do Claude soạn ngày 18/11/2026 từ lần chạy máy thật (OnePlus PLQ110, ColorOS 16, Android 16). Dựa trên `main` sau HB-247; không phụ thuộc chuỗi HB-248/249/251.

## Vấn đề (quan sát trên máy thật)

1. Mọi màn của app vận hành có header **`index`**. Cả luồng (đăng nhập → PIN → màn chính → khách đến/khách đi/buồng phòng/tra cứu/vãng lai) chạy trong route `index` bằng state, nên tên route lộ ra.
2. Vì cùng lý do, nút **Back cứng** của Android ở màn Khách đến, Khách đi… thoát hẳn app thay vì về màn chính.
3. Khi máy để **chế độ tối**, chữ gợi ý trong ô nhập gần như không đọc được (ghi lại ở HB-247). Nguyên nhân: `app.json` khai `userInterfaceStyle: "light"`, nhưng trên Android, Expo chỉ áp cờ này khi có `expo-system-ui`. Prebuild cảnh báo "Install expo-system-ui in your project to enable this feature". Thiếu gói, theme native `DayNight` đi theo máy nên màu gợi ý thành màu của nền tối. App khách cũng thiếu gói này.

## Thay đổi

1. `src/stages.ts`:
   - `STAGES` và `stageTitle(stage)`: tiêu đề cho từng bước của luồng chính.
   - `ROUTE_TITLES`: tiêu đề cho từng file route.
   - `backStep(state)`: thứ tự xử lý nút Back. Đóng màn con trước (không đến / thu số dư / vãng lai mở từ khách đến), rồi đưa công cụ về màn chính. Ở màn chính và các bước đăng nhập, Back giữ hành vi mặc định.
2. `app/_layout.tsx` đặt tiêu đề cho mọi route từ `ROUTE_TITLES`. `app/index.tsx` gắn `<Stack.Screen options={{ title: stageTitle(stage) }} />` và đăng ký `BackHandler` theo `backStep`.
3. Thêm khoá `screen.*` vào catalog.
4. Thêm `expo-system-ui` (~57.0.4) cho cả hai app.

## Tiêu chí nghiệm thu

1. Mọi route trong `app/` và mọi bước của luồng chính có tiêu đề khác tên file. Test: `apps/operations-android/test/screen-titles.spec.ts`
2. Thứ tự xử lý nút Back được kiểm cùng file trên.
3. Máy thật, máy để chế độ tối:
   - Header hiện "Vận hành" / "Khách đi".
   - Chữ gợi ý "Tìm theo mã booking" đọc rõ.
   - Back ở màn Khách đi quay về màn chính; Back ở màn chính rời app.
   - Bản prebuild có `expo_system_ui_user_interface_style = light`.
4. Cũng trên bản này, chạy trọn trả phòng PH-261117-00001:
   - Lần xác nhận đầu bị từ chối vì còn phụ thu trả muộn 1.210.000 ₫ (`E_PAY_AMOUNT_MISMATCH`).
   - Thu số dư bằng tiền mặt.
   - Xác nhận lại: máy chủ chốt trả phòng, sinh 1 việc dọn phòng.

## Ngoài phạm vi

- **Chữ trên thanh trạng thái màu trắng trên nền sáng** (giờ, pin khó đọc), ở cả chế độ sáng lẫn tối.
  - Đã thử `<StatusBar barStyle="dark-content">` và `statusBarStyle: 'dark'` của native stack; `dumpsys window` không thấy cờ `LIGHT_STATUS_BARS` được đặt.
  - Cần điều tra riêng: dev client, edge-to-edge SDK 57, ColorOS.
- Back trong màn chi tiết của Khách đến về thẳng màn chính, không về danh sách, vì `ArrivalsScreen` giữ lựa chọn trong state riêng.
- Kết quả từ chối ở màn trả phòng nằm cuối vùng cuộn, khuất sau chân màn; phải cuộn mới thấy (giống màn nhận phòng trước HB-251).
- Tiêu đề cho app khách: làm ở HB-249.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
