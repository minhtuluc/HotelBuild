---
id: HB-246
title: 'API sao lưu & diễn tập phục hồi (phần API của HB-179) — GET/POST /system/backups, /restore; sidecar nhận việc'
risk: R2
owner: claude
max_lines: 1300
allow:
  - apps/api/prisma/migrations/0015_backup_operations/migration.sql
  - apps/api/prisma/schema.prisma
  - docs/04-thiet-ke/csdl.md
  - packages/contracts/src/system.ts
  - packages/contracts/src/openapi/paths/backups.ts
  - packages/contracts/src/openapi/paths/f2.ts
  - packages/contracts/src/openapi/registry.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/openapi.spec.ts
  - packages/api-client/src/f2.ts
  - packages/api-client/test/f2-endpoints.spec.ts
  - apps/api/src/modules/sys/backups/**
  - apps/api/src/modules/sys/operations/permissions.ts
  - apps/api/src/app.module.ts
  - apps/api/test/backups/backups.spec.ts
  - apps/api/test/migration/table-privileges.spec.ts
  - apps/api/test/rbac/routes/f5-pay.ts
  - apps/api/test/rbac/registered-routes.spec.ts
  - infra/prod/backup/backup-loop.sh
  - infra/prod/backup/restore-drill.sh
  - infra/prod/docker-compose.yml
  - docker/postgres.Dockerfile
  - docs/04-thiet-ke/api.md
  - docs/07-ban-giao/van-hanh/sao-luu-phuc-hoi.md
  - docs/08-thi-cong/tickets/HB-246-api-sao-luu.md
---

# HB-246 — API sao lưu & diễn tập phục hồi

## Nguồn

HB-179 (#297) làm phần hạ tầng (pgBackRest, sidecar, diễn tập bằng compose) và để lại `POST /system/backups`, `/restore` (api.md §2.13, BR-SYS-03). SCR-18 cần thêm một tuyến đọc trạng thái.

## Thiết kế

- **API không chạy lệnh hệ thống.** Lệnh ghi chỉ thêm một dòng `operations` (`BACKUP` / `RESTORE_DRILL`) cùng audit trong transaction idempotency, rồi trả 202 + `Location`.
- **Sidecar `backup`** (đã có pgBackRest và socket CSDL) giành việc mỗi 30 giây bằng `FOR UPDATE SKIP LOCKED`, chạy, rồi chốt `result_json` hoặc `error_code`. Lúc khởi động, thao tác còn `RUNNING` được chốt `E_SYS_BACKUP_INTERRUPTED`.
- **Diễn tập** phục hồi vào volume `drilldata` với socket `/tmp/pinehill-drill-sock`, cổng 5433, không nghe TCP; đo RTO, đếm dòng, rồi xoá. Socket production `/var/run/postgresql` không bị đụng.
- **`backup_catalog`**: một dòng ảnh chụp `pgbackrest info`, sidecar ghi, `app_rw` chỉ đọc. API dùng nó để liệt kê bản sao lưu và kiểm `backupId`.
- **Một việc nặng mỗi lúc**: API kiểm, chỉ mục duy nhất từng phần `uq_operations_backup_active` là hàng rào cuối (409 `E_SYS_REQUEST_IN_PROGRESS`).
- `PITR` = `pgbackrest backup --type=incr`; `FULL` = `--type=full`.

## Quyết định tự đưa ra

- Thêm `GET /system/backups` (không có trong api.md gốc) vì SCR-18 cần "xem trạng thái". Chỉ thêm, không phá hợp đồng.
- Dùng lại `E_SYS_REQUEST_IN_PROGRESS` cho "đang có sao lưu/diễn tập" thay vì thêm mã lỗi mới.
- SYSADMIN được `operations.read` để theo dõi thao tác của chính mình (service vẫn chỉ cho người tạo hoặc OWNER).
- Hai path backup chuyển từ `paths/f2.ts` sang `paths/backups.ts` (f2.ts đã quá 400 dòng).

## Tiêu chí nghiệm thu

- `test/backups/backups.spec.ts`: trạng thái đọc catalog (bỏ phần tử hỏng), 202 + replay cùng khoá, 409 khi đang có việc, CHECK chặn SUCCEEDED thiếu `result_json`, kiểm `backupId`/mốc/trường lạ của diễn tập, chỉ SYSADMIN, `app_rw` không INSERT/UPDATE được `backup_catalog`.
- HB010 (catalog CSDL = csdl §3), quyền bảng, RBAC oracle xanh.
- Chạy thật trên Docker cục bộ (SeaweedFS): xem mục "Bằng chứng" trong PR.
- `pnpm run ci` xanh.
