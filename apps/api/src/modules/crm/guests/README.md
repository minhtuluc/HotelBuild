# CRM — hồ sơ khách tại quầy (HB-149) + quản trị hồ sơ (HB-166)

`GET /api/v1/guests` (tra cứu), `POST /api/v1/guests` (tạo/nhận diện theo SĐT chuẩn hoá),
`POST /api/v1/guests/{guestId}/anonymize` (ẩn danh hoá theo yêu cầu khách),
`GET /api/v1/guests/{guestId}/loyalty` (hạng/điểm/số đêm), `POST /api/v1/guests/{guestId}/blacklist`
(đưa vào danh sách đen) và `DELETE /api/v1/guests/{guestId}/blacklist` (gỡ, `204`) — api.md §2.10.
Không có tuyến xoá cứng hồ sơ (§2.14); `test/crm/admin.spec.ts` khẳng định cả ở mức HTTP lẫn ở mức
danh sách tuyến `DELETE` của controller.

## Quy ước đã chốt trong mã (HB-149)

1. **SĐT canonical `+84XXXXXXXXX`** (BR-CRM-01): nhận `0XXXXXXXXX`, `84XXXXXXXXX`, `+84…`, có dấu cách/`.`/`-`
   rồi chuẩn hoá trước khi khớp hợp đồng; sai mẫu → `422 E_CRM_PHONE_INVALID`. Cột `phone` của CSDL có
   `CHECK` canonical cho hồ sơ chưa ẩn danh.
2. **Chống tạo trùng**: dựa trên chỉ mục duy nhất từng phần `uq_guests_phone WHERE anonymized_at IS NULL`
   với `ON CONFLICT … DO NOTHING`; hai quầy bấm cùng lúc chỉ sinh một hồ sơ, bên thua nhận hồ sơ đã có
   (`200`), bên thắng `201`.
3. **Phạm vi cơ sở**: hồ sơ khách không có cột cơ sở, nên nhân viên cơ sở chỉ thấy khách **có booking
   thuộc `propertyScope`** (BR-RBAC-02). Hệ quả có chủ ý: hồ sơ vừa tạo chưa phát sinh booking vẫn được
   trả ngay trong phản hồi `POST`, nhưng không xuất hiện trong danh sách của nhân viên khác.
   - `OWNER` có phạm vi chuỗi nên thấy cả danh bạ (kể cả hồ sơ chưa có booking).
   - Trùng SĐT của khách **chỉ** thuộc cơ sở ngoài phạm vi → `403 E_AUTH_OUT_OF_SCOPE` (api.md §6.3),
     không trả PII.
   - Ba tuyến quản trị dùng chung `assertReachable`: hồ sơ **chỉ** thuộc cơ sở ngoài phạm vi → `403
E_AUTH_OUT_OF_SCOPE`; hồ sơ không tồn tại → `404 E_GEN_NOT_FOUND`. Hồ sơ chưa phát sinh booking vẫn
     thao tác được (nhất quán với `POST /guests`, khác câu chữ "khách phải có booking thuộc scope" ở
     bảng §6.3 — ghi ở mục "Khoảng trống đã biết").
4. **Không gắn tài khoản khách** (QĐ-03 T11): tạo hồ sơ tại quầy không sinh `guest_credentials`.
5. **PII tối thiểu**: `guestSelect` chỉ trả trường của `guestSummarySchema`; `idNumber`, `dob`,
   `nationality`, `notes` không rời khỏi máy chủ. Ghi audit trong cùng transaction.
   `AuditWriter` che `phone`/`email` (giữ 4 ký tự cuối) nhưng **không** che `fullName`, nên mọi snapshot
   hồ sơ đi qua `auditGuest()` — hàm này thay họ tên bằng `****` (NFR-SEC-03, TC-CRM-04). Từ HB-166, cả
   `GUEST_CREATED` cũng dùng `auditGuest` (trước đây ghi họ tên thô).
6. **Danh sách đen**: `assertGuestNotBlacklisted(tx, guestId)` là điểm chặn dùng chung → `403
E_BOOK_BLACKLISTED` (BR-CRM-04). HB-151 (walk-in) và HB-144 (check-in) **phải** gọi hàm này trong
   transaction của mình; hiện chưa có tuyến nào trong kho gọi (hai ticket đó còn mở), nên hành vi chặn
   end-to-end chỉ kiểm được ở mức guard.

## Quản trị hồ sơ (HB-166)

| Tuyến                                | Permission      | Vai trò                                       | Mã thành công                | Audit                      |
| ------------------------------------ | --------------- | --------------------------------------------- | ---------------------------- | -------------------------- |
| `POST /guests/{guestId}/anonymize`   | `guests.manage` | MANAGER, OWNER                                | `200` + `guestSummarySchema` | `GUEST_ANONYMIZED`         |
| `GET /guests/{guestId}/loyalty`      | `guests.read`   | FRONT_DESK, RESERVATION_AGENT, MANAGER, OWNER | `200` + `guestLoyaltySchema` | —                          |
| `POST /guests/{guestId}/blacklist`   | `guests.manage` | MANAGER, OWNER                                | `201` + `guestSummarySchema` | `GUEST_BLACKLISTED`        |
| `DELETE /guests/{guestId}/blacklist` | `guests.manage` | MANAGER, OWNER                                | `204` (không thân)           | `GUEST_BLACKLIST_RELEASED` |

**Danh mục ẩn danh hoá** (`anonymize.ts`, `anonymizeData`): `full_name` → `'Khách đã ẩn danh'`;
`phone` → `'+84000000000'` (giữ dạng canonical nhưng là dãy 0, không thuộc dải số di động thật);
`email`/`id_number`/`dob`/`nationality`/`notes` → `NULL`; `gender` → `'UNSPECIFIED'`;
`blacklist_reason` → `'Hồ sơ đã ẩn danh hoá'` **khi** khách đang bị chặn (ràng buộc
`ck_guests_blacklist_reason` buộc lý do phải khác NULL khi `blacklisted`), ngược lại `NULL`;
`anonymized_at` ← `Clock` của máy chủ (không nhận từ thân yêu cầu).
Trong cùng transaction: `guest_notes.content` → `'[Ẩn danh hoá]'` và `loyalty_transactions.reason` → `NULL`
(đều là văn bản tự do có thể chứa PII; BR-CRM-05 nêu GuestNote bị ẩn danh hoá cùng hồ sơ, ma trận truy vết
§06 nêu thêm LoyaltyTransaction). **Giữ nguyên** `loyalty_tier`/`loyalty_points`/`total_stays` (cần đối
soát điểm), `blacklisted` (không tự gỡ chặn trong lượt ẩn danh), `consent_marketing`/`consent_at`/
`consent_version` (NFR-COMP-01: hồ sơ xử lý yêu cầu chủ thể dữ liệu lưu ≥ 24 tháng — TC-CRM-05), booking
và thanh toán (NFR-COMP-02).

**Idempotency**: lượt gọi lại (kể cả chạy song song) thấy `anonymized_at` đã có thì trả nguyên hồ sơ,
không ghi cột nào và **không** thêm bản ghi nhật ký; chốt chặn là `WHERE id = … AND anonymized_at IS NULL`
nằm ngay trong lệnh ghi nên chỉ một lượt thắng. Ba tuyến ghi không dùng `@Idempotent` (khớp `POST /guests`
sẵn có, vốn idempotent theo khoá nghiệp vụ): ẩn danh hoá và hai lệnh danh sách đen đều là lệnh **đặt trạng
thái**, lặp lại cho cùng kết quả và không sinh nhật ký thứ hai.

**Loyalty**: hạng/điểm đọc từ cột hồ sơ do luồng tích điểm ghi; `staysLast12Months` là **số đêm** của
booking **đã ở thực tế** (`CHECKED_IN`/`CHECKED_OUT` — BR-CRM-06 loại huỷ/no-show) có `check_in` trong cửa
sổ 12 tháng lùi theo lịch từ `Clock` (so bằng `::date` nên không phụ thuộc múi giờ phiên CSDL);
`totalStays` đọc cột `total_stays`; `updatedAt` là `guests.updated_at`.

**Văn bản tự do**: lý do ẩn danh hoá / lý do danh sách đen được đưa qua `maskOperationalText` (che
SĐT/email) trước khi lưu vào cột và trước khi ghi `audit_logs.reason` — cột `reason` không được
`AuditWriter` che.

**Báo cáo yêu cầu chủ thể dữ liệu**: `requestedAt` (mốc khách báo) không có cột riêng trong CSDL nên
được lưu trong snapshot `after_json` của `GUEST_ANONYMIZED` kèm `anonymizedAt` do máy chủ đặt.

## Khoảng trống đã biết

- “Điều chỉnh hạng/điểm thủ công” (HB-166 AC2) chưa có tuyến trong hợp đồng HB-160 → chưa có chỗ để
  ghi kèm lý do + audit; cần bổ sung hợp đồng trước khi làm (không tự thêm tuyến).
- Chưa có liên kết khách–cơ sở: hồ sơ chưa phát sinh booking vẫn thao tác được bởi nhân viên cơ sở bất kỳ
  (kế thừa quy ước HB-149); muốn siết theo câu chữ "khách phải có booking thuộc scope" của §6.3 thì phải
  thêm cột/bảng + BR (thay đổi lược đồ), không tự mở rộng ở đây.
- Cửa sổ 12 tháng tính theo **ngày UTC của `Clock`**, chưa quy đổi `BUSINESS_TIMEZONE` → lệch tối đa một
  ngày ở biên; muốn chính xác theo giờ khách sạn thì cần helper ngày trong `packages/domain`.
- Ẩn danh hoá chưa thu hồi `auth_sessions`/`guest_credentials` của khách (chưa có luồng nào tạo phiên
  khách gắn hồ sơ này; thuộc phạm vi ticket phiên khách).
- `guest_notes`/`loyalty_transactions` chưa có luồng ghi nào trong kho nên nhánh thay nội dung chỉ được
  kiểm bằng dữ liệu seed của `test/crm`.
