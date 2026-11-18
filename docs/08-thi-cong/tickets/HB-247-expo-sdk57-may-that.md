---
id: HB-247
title: Hai app Android chạy được trên máy thật — gói native khớp Expo SDK 57, màn Đặt PIN tự hỏi mật khẩu hiện tại
risk: R1
owner: claude
max_lines: 200
allow:
  - apps/operations-android/package.json
  - apps/customer-android/package.json
  - pnpm-lock.yaml
  - apps/operations-android/app/index.tsx
  - apps/operations-android/app/pin-setup.tsx
  - apps/operations-android/app/change-password.tsx
  - apps/operations-android/src/pin-setup-model.ts
  - apps/operations-android/src/strings.ts
  - apps/operations-android/test/pin-labels.spec.ts
  - apps/operations-android/test/pin-setup-model.spec.ts
  - docs/08-thi-cong/tickets/HB-247-expo-sdk57-may-that.md
unlock:
  - docs/08-thi-cong/tickets/HB-247-expo-sdk57-may-that.md
---

# HB-247 — Hai app Android chạy được trên máy thật

> Đặc tả do Claude soạn ngày 17/11/2026, sau lần chạy đầu tiên trên máy thật (OnePlus PLQ110, Android 16, API 36). Số thuộc dải backend để không trùng dải HB-3xx của phiên frontend.

## Vấn đề

Đến nay hai app Android chỉ được kiểm bằng vitest và `expo export` (chỉ đóng gói JS), nên lỗi ở tầng native và lỗi luồng màn hình chưa từng lộ ra.

1. **Crash ngay khi mở (cả hai app).** `expo-crypto` và `expo-secure-store` khai `~15.0.0` (bản của Expo SDK 54) trong khi `expo` là 57. Mã Kotlin của bản 15 gọi `expo.modules.kotlin.types.AnyTypeProvider`, lớp này không còn trong `expo-modules-core` 57: `ClassNotFoundException` tại `CryptoModule.kt:82` khi khởi tạo module registry. `expo install --check` còn báo `expo`, `expo-router`, `@expo/metro-runtime` cũ hơn bản khuyến nghị của SDK.
2. **Không đặt được PIN (operations-android).** `index.tsx` chỉ gán `currentPassword` ở nhánh đổi mật khẩu.
   - Người dùng không bị buộc đổi mật khẩu nhưng chưa có PIN, hoặc khôi phục phiên rồi tới màn Đặt PIN, gửi `currentPassword = ''`. `setPinRequestSchema` ném lỗi Zod ngay trên máy; request không đi; màn báo "Đăng nhập thất bại: UNKNOWN".
   - Sau khi đổi mật khẩu, màn đổi mật khẩu trả **mật khẩu cũ** cho màn Đặt PIN. API so với mật khẩu đã đổi nên trả 401, và lần sai này còn bị đếm vào bộ khoá đăng nhập.

## Thay đổi

1. Hai `package.json`: `expo` ^57.0.33, `expo-router` ^57.0.31, `@expo/metro-runtime` ^57.0.18, `expo-crypto` ~57.0.4, `expo-secure-store` ~57.0.4; cập nhật `pnpm-lock.yaml`.
2. Màn Đặt PIN có ô **Mật khẩu hiện tại** riêng. Kiểm tra cục bộ tách ra `src/pin-setup-model.ts`: PIN không khớp → `pin.setup.mismatch`; mật khẩu trống → `pin.setup.passwordRequired` (thông báo rõ thay vì UNKNOWN). `index.tsx` không còn giữ mật khẩu trong state; `ChangePasswordScreen.onDone` không còn trả mật khẩu ra ngoài.

## Tiêu chí nghiệm thu

1. Hai PIN khớp + mật khẩu đã nhập → thân `PUT /auth/pin` — test: `apps/operations-android/test/pin-setup-model.spec.ts`
2. PIN không khớp / mật khẩu trống → thông báo cục bộ, không gọi API — cùng file.
3. Màn Đặt PIN có ba ô theo thứ tự mật khẩu hiện tại, PIN lần 1, PIN lần 2; ô PIN giữ `secureTextEntry`, `maxLength` 6, bàn phím số — test: `apps/operations-android/test/pin-labels.spec.ts`
4. Máy thật (bằng chứng trong PR): bản debug native của operations-android mở được; đăng nhập `frontdesk` → khôi phục phiên → Đặt PIN (`PUT /auth/pin` 204) → màn chính → "Khách đến hôm nay" tải dữ liệu.

## Ngoài phạm vi

- TypeScript 6 (`expo install --check` khuyến nghị ~6.0.3): đổi toàn repo, ticket riêng.
- Lỗi giao diện thấy trên máy thật, ghi lại cho phiên frontend: tiêu đề header hiện tên route `index`; chữ gợi ý (placeholder) ô nhập gần như không đọc được khi máy để chế độ tối vì app ép giao diện sáng mà không đặt `placeholderTextColor`.
- Không commit thư mục `android/` sinh bởi `expo prebuild`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
