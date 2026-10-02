---
id: HB-038
title: SCR-21 sơ đồ buồng & phòng vật lý + gán phòng thông nhau (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 700
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
  - packages/contracts/src/openapi/paths/f2.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/**
  - packages/api-client/src/f2.ts
  - packages/api-client/test/**
  - docs/04-thiet-ke/api.md
  - docs/05-ke-hoach/lo-trinh-thi-cong-web-android.md
locked:
unlock:
---

# HB-038 — SCR-21 sơ đồ buồng & phòng vật lý + phòng thông nhau

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-038 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Quản lý cơ sở xem được buồng theo tầng (mã phòng, loại phòng, trạng thái) và gán/gỡ **phòng thông nhau** cho một phòng. Liên kết là **hai chiều** (BR-OVER-15) nên giao diện **không** tự suy đoán phòng đối ứng: sau khi ghi thành công, màn hình đọc lại danh sách và hiển thị đúng những gì máy chủ trả.

## Căn cứ

- Pha: F2 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.4 (`SCR-21`)
- Quy tắc nghiệp vụ: BR-PROP-05 (mã phòng không trùng trong cơ sở), BR-OVER-15 (thông nhau đối xứng hai chiều)
- Use case / yêu cầu: UC-PROP-03; FR-PROP-05
- API: `GET /api/v1/rooms` (HOUSEKEEPING), `PUT /api/v1/rooms/{roomId}/connecting-room` (MANAGER, `If-Match`); mã lỗi `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`, `E_GEN_VERSION_CONFLICT`, `E_GEN_NOT_FOUND`
- Màn hình: `SCR-21`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/rooms` thì thấy mã phòng, tầng, mã loại phòng, trạng thái (nhãn Việt + mã enum) và phòng đang thông với nó — test: `rooms.spec.ts::hiện danh sách phòng theo tầng`
2. Gán phòng thông nhau gửi `PUT` kèm `If-Match` = `"version"` và thân `{ connectingRoomId }`, rồi **đọc lại danh sách**: cả hai phòng đều hiện liên kết (đối xứng do máy chủ bảo đảm) — test: `rooms.spec.ts::gán phòng thông nhau rồi đọc lại thấy đối xứng`
3. Gỡ liên kết gửi `connectingRoomId: null` — test: `rooms.spec.ts::gỡ liên kết gửi null`
4. `412` khi gán thì hiện xung đột, không tự ghi đè — test: `rooms.spec.ts::412 hiện xung đột`
5. `403` khi đọc thì hiện thiếu quyền, không lộ danh sách phòng — test: `rooms.spec.ts::403 hiện thiếu quyền`
6. Mất mạng khi gán là "chưa xác định kết quả", không báo thất bại chắc chắn — test: `rooms.spec.ts::mất mạng khi gán là chưa xác định kết quả`
7. Mọi trạng thái của §8.1 hiện đúng và không có vi phạm axe serious/critical — test: `screens.spec.ts` (thêm `/rooms` vào danh sách màn)

## Ngoài phạm vi

- Không thêm/sửa/xoá phòng vật lý (hợp đồng F2 chưa có tuyến tạo phòng) — sẽ bổ sung khi SCR-21 cần, tách ticket riêng nếu lead yêu cầu.
- Không làm SCR-22 (khoá phòng) và các màn còn lại của F2.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e` · `npm run check:docs` nếu đụng docs

## Ghi chú cho người làm

- Nhánh này **xếp chồng** trên `ticket/HB-037-scr19-20` để dùng lại `lib/screen-state.ts`, `components/screen-alert.tsx`, `components/forced-state.ts`, `lib/demo-states.ts`, `GET /room-types` và `listRoomTypes`. Vì `check:scope` chặn mọi file trong `docs/08-thi-cong/**` ngoài chính đặc tả của mình, **đặc tả HB-037 bị bỏ khỏi nhánh này** (nội dung nó vẫn còn trên nhánh HB-037 và PR #39); khi HB-037 merge thì rebase lên `main` sẽ tự khôi phục. Đây là lý do diff của HB-038 lớn hơn `max_lines` — đã giải trình ở PR.
- Địa chỉ API **truyền từ server component** (`webEnv().NEXT_PUBLIC_API_BASE_URL`) và tuyến khai `dynamic = 'force-dynamic'` — biến `NEXT_PUBLIC_*` bị nhúng lúc build nên client tự đọc sẽ hỏng khi chạy thật.
- Hiển thị mã loại phòng cần `GET /room-types` (bổ sung ở HB-037); nếu chưa có thì hiện `roomTypeId`.
