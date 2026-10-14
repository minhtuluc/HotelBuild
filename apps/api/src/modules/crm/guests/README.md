# CRM — hồ sơ khách tại quầy (HB-149, nền cho HB-166)

`GET /api/v1/guests` (tra cứu) và `POST /api/v1/guests` (tạo/nhận diện theo SĐT chuẩn hoá) — api.md §2.10.
Không có tuyến xoá cứng hồ sơ (§2.14).

## Quy ước đã chốt trong mã

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
4. **Không gắn tài khoản khách** (QĐ-03 T11): tạo hồ sơ tại quầy không sinh `guest_credentials`.
5. **PII tối thiểu trong phản hồi**: chỉ trả các trường của `guestSummarySchema`; `idNumber`, `dob`,
   `nationality` không rời khỏi máy chủ. Ghi audit `GUEST_CREATED` trong cùng transaction; `AuditWriter`
   che `phone`/`email` (giữ 4 ký tự cuối) nên nhật ký không chứa PII thô.
6. **Danh sách đen**: `assertGuestNotBlacklisted(tx, guestId)` là điểm chặn dùng chung → `403
   E_BOOK_BLACKLISTED` (BR-CRM-04). HB-151 (walk-in) và HB-144 (check-in) **phải** gọi hàm này trong
   transaction của mình; hiện chưa có tuyến nào trong kho gọi (hai ticket đó còn mở), nên hành vi chặn
   end-to-end chỉ kiểm được ở mức guard.

## Khoảng trống đã biết

- “Điều chỉnh hạng/điểm thủ công” (HB-166 AC2) chưa có tuyến trong hợp đồng HB-160 → chưa có chỗ để
  ghi kèm lý do + audit; cần bổ sung hợp đồng trước khi làm.
- Chưa có liên kết khách–cơ sở: nếu muốn nhân viên thấy hồ sơ chưa phát sinh booking của cơ sở mình thì
  phải thêm cột/bảng + BR (thay đổi lược đồ), không tự mở rộng ở đây.
