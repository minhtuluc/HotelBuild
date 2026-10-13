# HB-035 — cấu hình allotment

MANAGER/OWNER theo UC-INV-03, kiểm propertyScope trước cả replay. GET chỉ đọc
cấu hình thực trong range inclusive, used từ demand live, snapshot REPEATABLE
READ và no-store; ETag là version toàn scope, không phải cache validator demand.

PUT: idempotency transaction READ COMMITTED → đọc scope → FOR SHARE property,
room type, rooms theo ID → đọc lại scope (đổi property thì retry toàn TX) → khoá
channel_allotment_scopes → kiểm mọi quota theo số đơn vị ACTIVE → upsert toàn
lô → AuditLog → InventoryChanged outbox → ETag204. Thiếu If-Match428, cũ/sai412;
vượt quota409 trả mọi ngày vi phạm. Không cộng hạn mức các kênh; block không
thay ceiling ACTIVE. DOR đếm giường. Cập nhật quota giữ cache used và closure.

ETag interceptor đặt header trước durable normalization, không dùng native Res
trên route idempotent. Static exposed-header giữ ETag đọc được cả fresh/replay.
Outbox là invalidation chứa scope/version/dates, không gửi quota thô tới OTA;
relay/delivery thuộc worker. Audit/outbox lỗi rollback cả batch/version/claim.

## Authorization after resource waits

PUT rechecks the current account role, activity and selected property scope after both inventory resource locks and the channel×room-type scope lock. The existing `assertLockedActor` helper holds the user and selected scope rows `FOR SHARE` until commit. A revocation while waiting denies the batch and rolls back bootstrap scope/version, quota, audit, outbox and durable success together. OWNER retains existing global permission without requiring a property scope row.

Lock order: property → room type → rooms ordered by id → allotment pair scope → user → selected user-property scope. No changes to quota capacity, used demand, closure state, optimistic ETag or pool semantics. GET remains RepeatableRead without write locks. Authentication/idempotency preflight still protects durable replay; the second check protects a newly executing command after its last resource wait.
