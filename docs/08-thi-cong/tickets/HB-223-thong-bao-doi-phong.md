---
id: HB-223
title: RoomMove thực thi báo khách (BR-OVER-10) — thông báo `room-moved` cùng transaction
risk: R1
owner: claude
max_lines: 250
allow:
  - apps/api/src/modules/over/moves/notify.ts
  - apps/api/src/modules/over/moves/service.ts
  - apps/api/src/modules/over/over.module.ts
  - apps/api/test/over/room-move-notification.spec.ts
---

# HB-223 — RoomMove thực thi báo khách

## Mục tiêu

BR-OVER-10: mọi `RoomMove` PHẢI tạo bản ghi, ghi `AuditLog` và **gửi thông báo cho khách trong 15 phút**. QA HB-194 (QA-F6-10) đo trên API thật: nâng hạng `EXECUTED` nhưng sau 120 giây bảng `notifications` vẫn trống; execute chỉ ghi outbox `InventoryChanged`. Worker đã có mẫu `room-moved` ("Thông báo đổi phòng"), chỉ thiếu phía API ghi thông báo.

## Quyết định

- Ghi `PENDING` qua `NotificationGateway.record` trong transaction của execute (lệnh thất bại rollback thì không có thông báo), rồi `publish` để worker gửi — đúng mẫu `pay/reconciliation` và `noti/README`.
- Người nhận: email của khách nếu có, ngược lại SĐT (kênh `SMS`). Nội dung chỉ gồm khoá `notificationMessageSchema` (tên, mã booking, ngày, câu thông báo cố định); **không** chép lý do nội bộ của nhân viên.
- Áp cho mọi loại move gồm walk-out (câu thông báo riêng).

## Tiêu chí nghiệm thu

1. Điều chuyển thực thi ⇒ đúng 1 thông báo `room-moved` gắn booking, gửi tới SĐT khách, không lộ lý do nội bộ — test: `apps/api/test/over/room-move-notification.spec.ts::HB223_executed_relocation_notifies_guest_once`.
2. Execute thất bại (412) ⇒ không có thông báo — test: `…::HB223_failed_execute_leaves_no_notification`.
3. Walk-out thực thi ⇒ 1 thông báo `room-moved` — test: `…::HB223_executed_walkout_notifies_guest`.
4. Test khoá OVER (`apps/api/test/over/*.locked.spec.ts`) xanh, không sửa.

## Ngoài phạm vi

Thông báo khi ghép phòng (`RoomMerge`) không thuộc BR-OVER-10. Relay quét `PENDING` khi `publish` lỗi (khoảng trống đã ghi ở noti/README).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/over/**`.
