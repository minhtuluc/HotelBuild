# syntax=docker/dockerfile:1
# HB-179 — PostgreSQL 16 + pgBackRest: WAL lưu trữ liên tục và bản full hằng ngày ra kho S3 off-site, mã hoá
# AES-256 phía máy (kho không thấy dữ liệu rõ). Cùng một image cho `postgres` (archive-push), `backup`
# (sidecar lập lịch) và `restore-drill` (diễn tập PITR vào volume tạm). Cấu hình pgBackRest đọc hoàn toàn từ
# biến `PGBACKREST_*` (compose), không có file cấu hình chứa bí mật trong image.
FROM postgres:16-alpine
RUN apk add --no-cache pgbackrest \
  && install -d -o postgres -g postgres -m 0750 /var/log/pgbackrest /var/spool/pgbackrest /var/lib/pgbackrest \
  && install -d -o postgres -g postgres -m 0770 /tmp/pgbackrest \
  && install -d -o postgres -g postgres -m 0700 /var/lib/pinehill-drill
COPY --chmod=0755 infra/prod/backup/backup-loop.sh /usr/local/bin/pinehill-backup
COPY --chmod=0755 infra/prod/backup/restore-drill.sh /usr/local/bin/pinehill-restore-drill
# /var/lib/pinehill-drill: volume tạm cho diễn tập theo yêu cầu API (HB-246) trong sidecar `backup`; tạo sẵn
# thuộc postgres để named volume khởi tạo từ image cũng thuộc postgres (PGDATA bắt buộc 0700).
# Chạy không root (Trivy DS-0002). Image gốc đã tạo $PGDATA và /var/run/postgresql thuộc user postgres nên
# named volume khởi tạo từ image cũng thuộc postgres; entrypoint chính thức hỗ trợ chạy thẳng bằng user này.
USER postgres
