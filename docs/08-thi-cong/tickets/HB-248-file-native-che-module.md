---
id: HB-248
title: Trên Android, `./netinfo` và `./storage` không còn bị file `.native` cùng tên che mất export
risk: R1
owner: claude
max_lines: 250
allow:
  - apps/customer-android/src/**
  - apps/customer-android/app/**
  - apps/customer-android/test/native-shadow.spec.ts
  - apps/operations-android/src/**
  - apps/operations-android/test/native-shadow.spec.ts
  - docs/08-thi-cong/tickets/HB-248-file-native-che-module.md
unlock:
  - docs/08-thi-cong/tickets/HB-248-file-native-che-module.md
---

# HB-248 — File `.native` cùng tên che mất module thường trên Android

> Đặc tả do Claude soạn ngày 17/11/2026 từ lần chạy máy thật (OnePlus PLQ110, Android 16). Chồng trên HB-247.

## Vấn đề

- Metro trên Android ưu tiên `X.native.ts` khi gặp `import … from './X'`.
- Cả hai app có cặp `netinfo.ts` + `netinfo.native.ts` và `storage.ts` + `storage.native.ts`. Bản `.native` chỉ export `netInfoSource` / `secureStorage`, nên trên máy thật `OfflineError`, `requireOnline`, `memoryStorage`, `SESSION` đều là `undefined`.
- Vitest chạy trên Node lấy `X.ts`, nên test không thấy lỗi.
- Hậu quả quan sát được: tìm phòng ở customer-android ném `TypeError: right operand of 'instanceof' is not an object` và kẹt ở "Đang tải…". Mọi reader `instanceof OfflineError` của operations-android (khách đến, buồng phòng, tra cứu, xem trước, F6) cũng hỏng như vậy mỗi khi API trả lỗi.

## Thay đổi

1. Đổi tên `netinfo.native.ts` → `netinfo-device.native.ts` và `storage.native.ts` → `storage-device.native.ts` ở cả hai app; sửa mọi import trỏ thẳng tới chúng. Import `./netinfo` / `./storage` nay luôn ra file thuần trên mọi nền tảng.
2. Test chặn `test/native-shadow.spec.ts` ở mỗi app: không file `*.native|android|ios.*` nào được trùng tên gốc với một module thường trong `src/` hoặc `app/`.

## Tiêu chí nghiệm thu

1. Không còn cặp file che nhau — test: `apps/{customer,operations}-android/test/native-shadow.spec.ts`
2. Bộ phát hiện bắt được cặp `netinfo.ts`/`netinfo.native.ts` và bỏ qua file native đặt tên riêng — cùng file.
3. Máy thật: tìm phòng customer-android không còn TypeError; tham số sai hiện "Không tải được kết quả: E_GEN_VALIDATION_FAILED" kèm Thử lại; tham số đúng hiện danh sách loại phòng còn chỗ và giá.

## Ngoài phạm vi

- Ô "Cơ sở (mã)" nhận mã như `CS-01` nhưng API cần id (UUID) — làm ở ticket điều hướng/chọn cơ sở của customer-android.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
