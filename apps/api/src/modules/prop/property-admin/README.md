# HB-033 — PROP API thật

Read/controller riêng với commands cấu hình/phòng/liên kết. Không xoá cứng.
Published GET/PATCH properties; GET/POST/PATCH room-types; GET/POST/PATCH rooms;
PUT rooms/id/connecting-room; public/properties chỉ metadata ACTIVE.

Read4roles HOUSEKEEPING/FRONT_DESK/MANAGER/OWNER. Owner cấu hình; Manager/Owner
rooms. Scope tạiSQL/ORM và trước replay; users +scope row SHARE sau resource
lock, active/current-role/permission/scope reread. No role inheritance.

Writes chạy trong IdempotencyContext TX, audit sameTX; property/type version
bigint, room epoch microseconds updated_at. Migration0005 room touch monotonic,
không dựa Date millisecond. NativeRoomIfMatch numeric safe integer; ETag inside
idempotency để fresh/replay giống nhau. Create không cần IfMatch. Audit proof
server-owned top-levelpropertyId dùng được bởi scopedAuditHB036.

Lock property trước type/room; connecting khoá graph vật lý nhỏ toàn cơ sở theo
UUID ASC, detach reciprocal partners trước setcặp mới. Mọi phòng bị chạm được
audit/timestamp; lỗi bất kỳ rollback, wholeTX retry theo sharedstore khi lock/deadlock.
Room code mới theoBR, dữ liệu seed mãlegacy giữ nguyên. bedCount của loại suyra
BR DOR6/otherscapacity; không thêm storage duplicated. Số đơn vị bán đọc thực tế
roomsACTIVE (bedcount chỉshared). Safe VNDs/bands/5percent validated tạiserver.

Text mask conservatively catches labeled PII/secrets, không suy đoán arbitrary
unlabeled personal names. Không nhận actor/principal/scope từ body. Snapshot
booking cũ không được sửa. Gate/thực chạy/bằng chứng ở hồ sơ ngoài repo HB-F6-specs.
