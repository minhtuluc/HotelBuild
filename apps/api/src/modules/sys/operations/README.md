# SYS operations — theo dõi thao tác bất đồng bộ (HB-163, dùng lại cho HB-179)

Hai tuyến đọc của bảng `operations`: `GET /api/v1/operations/{operationId}` (trạng thái) và
`GET /api/v1/operations/{operationId}/download` (tải tệp xuất có hạn). Lệnh **tạo** thao tác nằm ở module
gọi (`modules/rep/export` cho HB-163 — xem README ở đó, gồm cả `@Idempotent` và `Location`).

## Kiểm quyền (api.md §6.4, BR-RBAC-02, BR-GEN-08)

`authorize()` kiểm **quyền hiện tại**, không chỉ người tạo: OWNER xem mọi thao tác; còn lại phải đúng
`requested_by` **và** phạm vi cơ sở hiện tại phải bao phủ `property_scope` đã chụp lúc yêu cầu
(`row.property_scope.every((id) => actor.canActOn(id))`). Nhân viên bị thu hẹp quyền sau khi yêu cầu thì
không đọc lại được ảnh chụp cũ — trước đây chỉ kiểm người tạo nên dữ liệu vẫn xem được (lỗ hổng đã bịt).

`resultRef` (link ký) chỉ xuất hiện khi `SUCCEEDED` **và** tệp còn hạn; hết hạn thì bỏ trường thay vì trả
link chết. Tuyến tải cần **cả** bearer token của người yêu cầu/OWNER **và** chữ ký HMAC-SHA256 trên
`operationId:expires`; sai chữ ký ⇒ 403, quá hạn/chệch hạn ⇒ 404 kèm dọn tệp ngay tại chỗ đọc.

## Tệp xuất: vòng đời và dọn dẹp

- Tệp do worker ghi trong `EXPORT_DIR`; mọi đường dẫn đọc phải qua `insideExportDir` (chặn `..` và mọi
  thư mục khác) — API **không** đọc tệp tuỳ ý từ đường dẫn trong CSDL.
- Hạn tệp (`result_expires_at`) chỉ *cho phép* đọc trong hạn; việc **xoá** tệp không còn phụ thuộc lượt tải:
  worker có job dọn định kỳ `q.export-cleanup` (mặc định 15 phút, `EXPORT_CLEANUP_INTERVAL_SECONDS`) xoá tệp
  quá hạn và **giữ nguyên hàng** `operations` (ràng buộc `ck_operations_succeeded` buộc `result_path` NOT NULL
  khi `SUCCEEDED`; tệp mất ⇒ tuyến tải trả 404 như tệp hết hạn).
- Vòng đời hàng do worker chốt: giành thao tác bằng `UPDATE … WHERE status IN ('PENDING','RUNNING')` nên lượt
  chết giữa đường vẫn chạy lại được; chỉ **lượt thử cuối** của BullMQ mới đánh `FAILED` (kèm `error_code` +
  audit `REPORT_EXPORT_FAILED`).

## Quyết định tự đưa ra

- **Đọc/ghi bằng SQL thô** (bảng không khai trong `prisma/schema.prisma`) để không phải sinh lại Prisma client
  trong cùng PR; mọi câu lệnh nằm gọn trong module này và `modules/rep/export`.
- **Chữ ký dùng `JWT_ACCESS_SECRET`** thay vì thêm biến môi trường mới; link vẫn phải kèm bearer token.
- **Không xoá hàng `operations`** khi dọn tệp: hàng là vết thao tác (và HB-179 sẽ dùng lại), chỉ tệp là tạm.
- **`E_GEN_NOT_FOUND` cho mọi ca không đọc được tệp** (không tồn tại, quá hạn, chệch hạn ký, tệp đã bị dọn) để
  không lộ sự khác biệt giữa các ca; chữ ký **sai** là 403 vì đó là lệnh hỏng, không phải tài nguyên vắng.
