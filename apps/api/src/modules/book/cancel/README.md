# HB-097 — `cancel-preview` + `cancel` (UC-BOOK-08)

`POST /api/v1/bookings/{bookingId}/cancel-preview` thuần đọc; `POST …/cancel`
đổi trạng thái toàn phần/một phần trong một transaction: kiểm lại neo xem trước,
tính hoàn/phạt bằng engine `@pinehill/domain/cancellation` (HB-053), nhả assignment + void nghĩa vụ +
giữ hạn mức hoàn qua `BookingLedger` (HB-093), audit cùng transaction. Booking chưa xác nhận hoàn đúng
số đã thu (QĐ-05), không làm tròn.

## Hai bước bắt buộc và neo xem trước (AC1)

- `cancel-preview` trả `ETag` dạng `"<version>.<vân tay 16 hex>"` (`anchor.ts`). Vân tay phủ **toàn bộ**
  kết quả xem trước: `policyId`, bậc áp dụng, tỷ lệ hoàn, `paidAmount`, `requestedAmount`,
  `penaltyAmount`, `refundFee`, cờ bất khả kháng và **tập phòng** đã chọn.
- `cancel` **bắt buộc** `If-Match` = `ETag` đó (api.md §1.3): thiếu header → `428`; token sai định dạng
  hoặc lệch mốc → `412` (phải xem trước lại). Lệch **version**, lệch bậc (qua mốc giờ) hoặc khác tập
  phòng đều cho `412` — không có nhánh nào áp số của lần xem trước mà không kiểm lại trong transaction.
- `hoursBeforeCheckIn` **không** vào vân tay: đại lượng này trôi liên tục theo đồng hồ nên neo sẽ vô dụng.
  Mốc giờ vẫn bị ràng buộc gián tiếp vì qua bậc là `appliedTierId`/`refundPercent`/`requestedAmount` đổi.
  Trường này được trả ở 2 chữ số thập phân (khớp cột `hours_before_check_in`) để hai lần đọc so sánh được.
- Tập phòng của lần xem trước đi bằng query `?bookingRoomIds=<uuid>,<uuid>` (thân lệnh `cancel-preview`
  của hợp đồng đã chốt chỉ có `reason`/`isForceMajeure`). Bỏ trống ⇒ toàn bộ phòng đang hoạt động, đúng
  như lệnh huỷ không truyền `bookingRoomIds`. Xem trước tập X rồi huỷ tập Y ⇒ `412`.
- Hệ quả: **UI SCR-11/35/36/69 phải gửi `If-Match`** (và query tập phòng khi huỷ một phần); hiện
  `apps/operations-web` chưa gửi nên cần một ticket UI (ngoài phạm vi HB-097).

## Quyết định tiền

- Quyết định tiền do engine: `context.ts` gom nền (nền phân bổ bất biến từ `booking_charges.amount`
  của nghĩa vụ phòng–đêm, chính sách từ `PriceSnapshot.policy_snapshot_json` mới nhất, mốc danh nghĩa
  BR-GEN-04) rồi gọi engine; tầng API chỉ **phân phối net cho từng nguồn** (`engine.ts`).
- Bất khả kháng (BR-CANCEL-13): 100% cơ sở, miễn phạt/phí. **Xem trước không bị chặn** cho bất kỳ vai
  trò nào có quyền đọc và trả cảnh báo `FORCE_MAJEURE_REQUIRES_MANAGER`; lệnh huỷ mới chặn `403` và đòi
  `note` ≥ 20 ký tự (`400`).
- `channelManaged` chỉ khi booking **thực sự** đến từ kênh OTA: `channels.code` ∈ `OTA_BOOKING`/
  `OTA_AGODA`/`OTA_AIRBNB` **và** có `channel_policy_code` (BR-CHAN-04). Lý do `OTA_CANCELLATION` cho
  booking khác ⇒ `409 E_CANCEL_NOT_ALLOWED` (không im lặng bỏ khoản hoàn); xem trước trả cảnh báo
  `OTA_REASON_REQUIRES_OTA_CHANNEL`.
- Huỷ một phần (`bookingRoomIds[]`, `roomCount > 1`): trạng thái giữ nguyên, `totalAmount` giảm, snapshot
  `PARTIAL_CANCEL` mới (bản gốc bất biến) sao **nguyên vẹn** từng dòng `nights[]` của bản nguồn (giữ
  `date`, giá cơ bản, hệ số, nguồn/version giá, hoa hồng) và **tính lại mọi tổng từ các đêm còn lại** để
  JSON khớp hai cột `gross_amount`/`commission_amount`. `totals.depositAmount` giữ nguyên giá trị của bản
  nguồn: cọc tính theo BR-PAY-01 từ `ratePlan.depositPercent`, không suy ra được từ danh sách đêm và
  `packages/domain` chưa công khai hàm làm tròn cọc — không tự chép công thức tiền vào tầng API.
- Phạm vi cơ sở: OWNER có phạm vi **toàn chuỗi** (không cần hàng `user_property_scopes`), như
  `canActOn` ở `common/rbac/scope.ts`; vai trò khác phải có hàng scope của cơ sở booking.

## Đường khách GUEST (chờ HB-017)

`permissions.ts` hiện chỉ khai bảy vai trò nhân viên. Không thể khai `GUEST` tại đây:

- `PermissionRegistry.onModuleInit` từ chối mọi vai trò ngoài `userRoleSchema` **ngay khi khởi động**
  (`Invalid permission role`), mà `userRoleSchema` chỉ có bảy vai trò nhân viên.
- `RbacGuard`/`AuthGuard` giải danh tính từ bảng `users`, chưa có phiên khách (HB-017); cả `GET /guests/me`
  của api.md §2.10 cũng chưa có trong API.

⇒ Mở đường khách là việc của HB-017 (phiên khách + mô hình quyền cho principal GUEST) rồi mới khai
`GUEST` ở map này và ràng buộc quyền sở hữu booking. Ca `guards.spec.ts` giữ bất biến "vai trò khai báo ⊆
`userRoleSchema`" để không ai lặng lẽ thêm vai trò lạ.
