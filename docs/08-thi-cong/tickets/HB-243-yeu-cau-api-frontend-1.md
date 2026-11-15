---
id: HB-243
title: 'Yêu cầu API frontend đợt 1 — propertyScope trong phiên, mã booking của ca quá tải, lọc nhiều trạng thái'
risk: R1
owner: claude
max_lines: 450
allow:
  - packages/contracts/src/auth.ts
  - packages/contracts/src/overbooking.ts
  - packages/contracts/src/booking.ts
  - packages/contracts/openapi.json
  - packages/api-client/src/booking.ts
  - packages/api-client/test/f4-endpoints.spec.ts
  - apps/api/src/modules/auth/auth.service.ts
  - apps/api/src/modules/auth/auth-sessions.ts
  - apps/api/src/modules/over/queries/service.ts
  - apps/api/src/modules/book/bookings/validation.ts
  - apps/api/src/modules/book/bookings/projection.ts
  - apps/api/test/bookings/hb243-session-scope-statuses.spec.ts
  - apps/api/test/over/case-booking-codes.spec.ts
  - docs/04-thiet-ke/api.md
  - YEU-CAU-API-TU-FRONTEND.md
  - docs/08-thi-cong/tickets/HB-243-yeu-cau-api-frontend-1.md
---

# HB-243 — Yêu cầu API frontend đợt 1

## Nguồn

`YEU-CAU-API-TU-FRONTEND.md` (session frontend, #298), các mục 1–4. Mục 5 (ảnh) làm riêng ở HB-244.

## Thay đổi (đều chỉ thêm, không phá hợp đồng)

1. **Phiên nhân viên.** `tokenPairSchema` có thêm `role?` và `propertyScope?`. `POST /auth/login` và `POST /auth/refresh` của nhân viên trả hai trường này, với **cùng** giá trị ký trong access token.
2. **Ca quá tải.** `overbookingCaseSummarySchema` có thêm `affectedBookingCodes?`: mã `PH-…`, sắp theo đúng thứ tự `affectedBookingIds`, áp dụng cho cả danh sách lẫn chi tiết.
   - Không làm yêu cầu 2b (tự gắn `caseId` khi đánh dấu trùng OTA). "Nghi trùng" chỉ là ghi chú soát xét, còn ca quá tải là kết quả của việc thiếu phòng; hai thứ không tương ứng một-một. Lý do đã ghi trong file yêu cầu.
3. **Giải phóng hold.** Khách vốn đã tự giải phóng được hold của mình (`DELETE /holds/{holdId}`), có test HB-076 AC3. Ticket này chỉ sửa `api.md`, nơi trước đây ghi nhầm vai trò là FRONT_DESK.
4. **Danh sách booking.** `GET /bookings` có thêm tham số `statuses` (danh sách phân tách dấu phẩy), không dùng cùng `status` (gửi cả hai thì 400). `api-client.list({ statuses: [...] })`.

## Tiêu chí nghiệm thu

- `test/bookings/hb243-session-scope-statuses.spec.ts`:
  - `HB243_staff_login_and_refresh_return_role_and_property_scope`: `role` và `propertyScope` khớp `user_property_scopes` và `GET /auth/me`, cả khi đăng nhập lẫn khi refresh.
  - `HB243_bookings_filter_by_several_statuses_in_one_call`: lọc đúng tập trạng thái; giá trị lạ, chuỗi rỗng sau dấu phẩy, hoặc dùng cùng `status` đều trả 400.
- `test/over/case-booking-codes.spec.ts::HB243_case_list_and_detail_return_booking_codes_in_affected_order`.
- Test khoá F6 (`detection-queries.locked`) giữ xanh: trường mới là optional, và projection cảnh báo (strict) không bị đổi.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/{bookings,over,auth}`.
