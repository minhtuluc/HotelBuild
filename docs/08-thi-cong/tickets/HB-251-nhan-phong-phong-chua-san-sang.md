---
id: HB-251
title: Nhận phòng trên Android khi phòng chưa có bằng chứng sẵn sàng — thấy lý do từ chối và ghi biên bản đã kiểm (BR-FO-07)
risk: R1
owner: claude
max_lines: 450
allow:
  - apps/api/src/modules/fo/check-in/errors.ts
  - apps/api/test/uc-check-in/refusal-reason.spec.ts
  - apps/operations-android/src/arrivals/**
  - apps/operations-android/test/**
  - docs/08-thi-cong/tickets/HB-251-nhan-phong-phong-chua-san-sang.md
unlock:
  - docs/08-thi-cong/tickets/HB-251-nhan-phong-phong-chua-san-sang.md
---

# HB-251 — Nhận phòng khi phòng chưa có bằng chứng sẵn sàng

> Đặc tả do Claude soạn ngày 17/11/2026 từ lần chạy app vận hành trên máy thật (OnePlus PLQ110, Android 16). Chồng trên HB-249.

## Vấn đề

1. Booking khách vãng lai tạo trên máy thật không nhận phòng được. Máy chủ trả `409 E_FO_CHECKIN_NOT_ALLOWED` "Phòng thực tế chưa sẵn sàng" vì phòng chưa có nhiệm vụ buồng phòng `DONE/INSPECTED/VERIFIED` cho ngày nhận phòng (BR-FO-07). Dữ liệu dev mới thì không phòng nào có bằng chứng này.
2. App nhận 409 nhưng lễ tân **không thấy thông báo**: `ResultNotice` nằm cuối nội dung cuộn (dưới ô CMND/ghi chú), còn nút bấm cố định ở chân màn.
3. API đã cho lễ tân ghi biên bản đã kiểm (`POST /housekeeping/tasks`, `INSPECTED`, HB-207). App không biết khi nào nên đề nghị việc này, vì lý do từ chối chỉ là câu chữ.

## Thay đổi

1. API: từ chối nhận phòng kèm `details: [{ field: 'reason', issue: <mã BR> }]` (an toàn, không PII; `details` là trường tuỳ chọn sẵn có của `errorBodySchema`).
2. App: `ActionFailure.rejected` có `reasonCode`. `needsInspection` nhận ra `UNITS_NOT_READY`. `CheckInWriter.recordInspection` dùng cùng quy tắc mạng/khoá idempotency với nhận phòng.
3. Vùng kết quả (`check-in-result`) chuyển sang chân màn cạnh nút xác nhận. Khi phòng chưa sẵn sàng, `InspectionPanel` ghi biên bản cho từng phòng đang chọn, ngày là ngày nhận phòng; lễ tân bấm xác nhận lại sau đó.

## Tiêu chí nghiệm thu

1. 409 `UNITS_NOT_READY` mang `details` lý do — test: `apps/api/test/uc-check-in/refusal-reason.spec.ts`
2. `reasonCode`/`needsInspection` chỉ đề nghị kiểm phòng cho `UNITS_NOT_READY` — test: `test/arrivals-model.spec.ts`
3. Ghi biên bản: một lần gửi, offline không gửi, kết quả chưa chắc giữ khoá — test: `test/arrivals-writer.spec.ts`
4. Từ chối hiện ở chân màn (ngoài ScrollView) → ghi biên bản → nhận phòng thành công — test: `test/arrivals-ui.spec.ts`

## Ngoài phạm vi

- Câu chữ riêng cho từng mã lý do khác (nợ, sai ngày…) — app vẫn hiện câu máy chủ trả.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
