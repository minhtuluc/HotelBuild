---
id: HB-030
title: Hợp đồng F2 — cơ sở, phòng, khoá phòng, lưới tồn, allotment, nhật ký kiểm toán, tham số, theo dõi operation
risk: R2
owner: deepseek
max_lines: 1000
allow:
  - packages/contracts/src/**
  - packages/contracts/test/**
  - packages/contracts/openapi.json
  - packages/api-client/src/**
  - packages/api-client/test/**
  - packages/ui-web/src/messages.ts
  - packages/ui-web/src/errors.ts
  - packages/ui-web/test/**
  - packages/ui-native/src/stateMessages.ts
  - packages/ui-native/test/**
unlock:
  - docs/04-thiet-ke/api.md
---

# HB-030 — Hợp đồng F2

## Mục tiêu

`packages/contracts` mô tả đủ endpoint F2 để backend (HB-033…HB-036) và màn hình (HB-037…HB-044) làm song song. Không đổi hành vi endpoint đã có.

## Căn cứ

- [api.md](../../04-thiet-ke/api.md) §2.2 PROP, §2.3 INV (trừ `inventory/availability` — thuộc HB-070), §2.13 SYS (`audit-logs`, `system-settings/{key}`, `system/backups`, `system/backups/{backupId}/restore`), mục theo dõi `GET /api/v1/operations/{operationId}`, §2.14 (endpoint cấm)
- FR-PROP-01…07, FR-INV-01, FR-INV-06, FR-INV-07, FR-SYS-01…03; UC-PROP-01…04, UC-INV-01, UC-INV-03, UC-SYS-01…03
- [csdl](../../04-thiet-ke/csdl.md) §3 (`properties`, `room_types`, `rooms`, `room_blocks`, `channel_allotments`, `audit_logs`, `system_settings`) cho tên/kiểu trường

## Tiêu chí nghiệm thu

1. Schema mỗi nhóm trong file riêng: `src/property.ts`, `src/inventory.ts`, `src/system.ts`; khai path trong file riêng `src/openapi/paths/f2.ts`, `registry.ts` chỉ thêm **một** dòng import/gọi. Request `strictObject`, response `object`; tiền là số nguyên VND; ngày `YYYY-MM-DD`, thời điểm ISO UTC theo schema dùng chung.
2. Mỗi endpoint đủ: vai trò tối thiểu và bearer theo bảng api.md, `If-Match` cho `PATCH /properties/{id}`, `PUT /channel-allotments`, `PUT /system-settings/{key}`; lệnh 202 trả `{ operationId, status, statusUrl }`; mã lỗi theo api.md (đã có trong catalogue: `E_INV_NO_AVAILABILITY`, `E_INV_LOCK_TIMEOUT`, `E_GEN_*`, `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`).
3. `GET /inventory/grid` có giới hạn khoảng ngày (tối đa 31 ngày) trong schema query.
4. `audit-logs` chỉ có GET; `restore` không nhận URL/đường dẫn CSDL (§2.14). Test khẳng định không tồn tại path/method cấm.
5. `pnpm openapi:generate`; `check:openapi` xanh; `check:contract` 0 phá vỡ.
6. `api-client`: `createPropertyApi`, `createInventoryApi`, `createSystemApi` trong file mới; test HTTP thật như hiện có.
7. Thông điệp UI cho mã lỗi chưa có câu chữ (nếu có). `pnpm run ci` + `npm run check:docs` xanh; bảng api.md chỉnh nếu phát hiện lệch (ghi trong PR).

## Ngoài phạm vi

- Hiện thực backend, màn hình; hợp đồng giá/chính sách (HB-050).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check:docs`

## Ghi chú cho người làm

HB-012 và HB-050 cũng sửa `packages/contracts`/`api-client`. Ai merge sau thì rebase, giữ thay đổi của cả hai ở `registry.ts`/`index.ts`/`errors.ts`, rồi **sinh lại** `openapi.json` (không sửa tay khi giải xung đột).
