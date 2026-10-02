---
id: HB-039
title: SCR-22 khoá phòng bảo trì/ngừng bán (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 800
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
locked:
unlock:
---

# HB-039 — SCR-22 khoá phòng bảo trì/ngừng bán

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-039 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Quản lý cơ sở tạo và gỡ **khoá phòng** (bảo trì, sửa chữa, chủ dùng, dọn sâu) theo khoảng ngày, thấy danh sách khoá đang có và **cảnh báo chồng lấn** trước khi lưu. Tồn phòng giảm ngay khi tạo khoá là việc của backend (HB-034); màn hình chỉ gửi yêu cầu và hiển thị kết quả máy chủ trả.

## Căn cứ

- Pha: F2 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.4 (`SCR-22`)
- Quy tắc nghiệp vụ: BR-INV-06 (khoá phòng làm giảm tồn), BR-PROP-06 (khoá đè booking cần MANAGER và mở `OverbookingCase`), BR-RBAC-01/02 (quyền theo vai trò × phạm vi)
- Use case / yêu cầu: UC-PROP-04; FR-PROP-06, FR-INV-07
- API: `GET /api/v1/room-blocks` (**bổ sung** — xem ghi chú), `POST /api/v1/room-blocks` (MANAGER), `DELETE /api/v1/room-blocks/{roomBlockId}` (MANAGER, `reason`); mã lỗi `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`, `E_GEN_VALIDATION_FAILED`, `E_GEN_NOT_FOUND`
- Màn hình: `SCR-22`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/room-blocks` thì thấy mã phòng, khoảng ngày, lý do (nhãn Việt + mã enum), ghi chú — test: `room-blocks.spec.ts::hiện danh sách khoá phòng`
2. Khoảng ngày mới chồng lấn một khoá đã có của cùng phòng thì hiện cảnh báo chồng lấn **trước khi** gửi — test: `room-blocks.spec.ts::cảnh báo chồng lấn trước khi gửi`
3. Tạo khoá gửi `POST` đủ `roomId`, `startDate`, `endDate`, `reason`, `note?` rồi đọc lại danh sách — test: `room-blocks.spec.ts::tạo khoá rồi đọc lại`
4. `endDate < startDate` thì chặn tại chỗ, không gọi API — test: `room-blocks.spec.ts::ngày không hợp lệ thì không gọi API`
5. Gỡ khoá gửi `DELETE` kèm `reason` bắt buộc (204) — test: `room-blocks.spec.ts::gỡ khoá kèm lý do`
6. `FRONT_DESK` gửi lệnh (403) thì hiện thiếu quyền, không lộ danh sách — test: `room-blocks.spec.ts::403 hiện thiếu quyền`
7. Mất mạng khi tạo là "chưa xác định kết quả", không báo thất bại chắc chắn — test: `room-blocks.spec.ts::mất mạng khi tạo là chưa xác định kết quả`
8. Mọi trạng thái §8.1 hiện đúng và không có vi phạm axe serious/critical — test: `screens.spec.ts` (thêm `/room-blocks`)

## Ngoài phạm vi

- Không tạo/sửa phòng vật lý (SCR-21, HB-038) và không quyết định khoá đè có mở `OverbookingCase` hay không — đó là backend HB-034.
- Không hàng đợi kiểm tra chồng lấn phía máy chủ: cảnh báo ở giao diện chỉ để nhắc, máy chủ vẫn là nơi chặn.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e` · `npm run check:docs` (đụng `docs/04`)

## Ghi chú cho người làm

- **Bổ sung hợp đồng `GET /api/v1/room-blocks`** (QĐ-04 mục 7, cùng cách xử lý như `GET /room-types` ở HB-037): api.md §2.2 chỉ có `POST` và `DELETE`, **không có tuyến đọc nào** trả khoá đang có, nên SCR-22 không liệt kê và không cảnh báo chồng lấn được. Đề xuất: vai trò HOUSEKEEPING (như `GET /rooms`), query `propertyId?`, `roomId?`, `from?`, `to?`; cập nhật api.md §2.2 trong cùng PR.
- Định nghĩa chồng lấn dùng ở giao diện (ghi rõ trong test): hai khoảng `[start, end]` chồng nhau khi `start ≤ otherEnd` **và** `otherStart ≤ end` (tính cả hai biên, vì khoá là "ngừng bán trong ngày").
- Phụ thuộc: HB-037/PR #39 (bộ dùng chung `lib/screen-state.ts`, `screen-alert`, `forced-state`, `demo-states`) và HB-038/PR #41 (`room-pairing` không dùng ở đây nhưng cùng nhánh nền). **Nhánh này chỉ chứa đặc tả; mã sẽ thêm sau khi #39 và #41 merge**, vì `check:scope` chặn `docs/08-thi-cong/**` của nhánh khác.
- Địa chỉ API **truyền từ server component** (`webEnv().NEXT_PUBLIC_API_BASE_URL`) + `dynamic = 'force-dynamic'`; biến `NEXT_PUBLIC_*` bị nhúng lúc build nên client tự đọc sẽ hỏng khi chạy thật.
- Nhãn lý do (`roomBlockReasonSchema`): `MAINTENANCE`, `RENOVATION`, `OWNER_USE`, `DEEP_CLEAN` — hiện nhãn Việt kèm mã enum theo §7.4.
