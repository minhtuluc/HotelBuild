---
id: HB-045
title: SCR-18 sao lưu & phục hồi (operations web) — làm cùng F9
risk: R1
owner: deepseek
max_lines: 400
allow:
  - apps/operations-web/src/app/(ops)/admin/backups/**
  - apps/operations-web/test/backups/**
  - tests/e2e/ops-backups.spec.ts
---

# HB-045 — SCR-18 sao lưu & phục hồi

## Mục tiêu

SYSADMIN xem trạng thái sao lưu, yêu cầu sao lưu, chạy diễn tập phục hồi vào môi trường tạm và theo dõi tiến trình qua `operationId`.

## Căn cứ

- SCR-18; UC-SYS-03; BR-SYS-03; api.md §2.13; hợp đồng `system.ts` + `createSystemApi` (HB-030)
- Backend: HB-179 (bắt buộc merge trước)

## Tiêu chí nghiệm thu

1. Nút sao lưu (`mode` PITR/FULL) và diễn tập phục hồi (thời điểm + lý do) có hộp xác nhận; giao diện **không** có ô nhập URL/đường dẫn CSDL.
2. Theo dõi `GET /operations/{operationId}`: `PENDING/RUNNING/SUCCEEDED/FAILED`, polling có điểm dừng, mốc "cập nhật lúc … giờ VN".
3. Chỉ SYSADMIN thấy tuyến; vai trò khác → trang thiếu quyền.
4. 9 trạng thái; axe sạch; E2E với API giả. `pnpm run ci` + `pnpm test:e2e` xanh.
