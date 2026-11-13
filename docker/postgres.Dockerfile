# syntax=docker/dockerfile:1
# HB-179 — PostgreSQL 16 + pgBackRest: WAL lưu trữ liên tục và bản full hằng ngày ra kho S3 off-site, mã hoá
# AES-256 phía máy (kho không thấy dữ liệu rõ). Cùng một image cho `postgres` (archive-push), `backup`
# (sidecar lập lịch) và `restore-drill` (diễn tập PITR vào volume tạm). Cấu hình pgBackRest đọc hoàn toàn từ
# biến `PGBACKREST_*` (compose), không có file cấu hình chứa bí mật trong image.
FROM postgres:16-alpine
RUN apk add --no-cache pgbackrest \
  && install -d -o postgres -g postgres -m 0750 /var/log/pgbackrest /var/spool/pgbackrest /var/lib/pgbackrest \
  && install -d -o postgres -g postgres -m 0770 /tmp/pgbackrest
COPY --chmod=0755 infra/prod/backup/backup-loop.sh /usr/local/bin/pinehill-backup
COPY --chmod=0755 infra/prod/backup/restore-drill.sh /usr/local/bin/pinehill-restore-drill
# Chạy không root (Trivy DS-0002). Image gốc đã tạo $PGDATA và /var/run/postgresql thuộc user postgres nên
# named volume khởi tạo từ image cũng thuộc postgres; entrypoint chính thức hỗ trợ chạy thẳng bằng user này.
USER postgres
