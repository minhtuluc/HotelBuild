#!/bin/sh
# HB-179 — sidecar sao lưu. Chạy trong container `backup` (user postgres), dùng chung volume dữ liệu
# (chỉ đọc) và socket với container `postgres`.
#   1. Chờ PostgreSQL sẵn sàng → `stanza-create` (idempotent) → `check` (chứng minh archive_command đẩy được
#      WAL lên kho, giải mã được) — sai cấu hình kho/khoá thì container dừng ngay, không im lặng.
#   2. Chưa có bản full nào ⇒ sao lưu full ngay (có điểm khôi phục từ phút đầu).
#   3. Mỗi ngày lúc BACKUP_FULL_AT_UTC (mặc định 19:00 UTC = 02:00 giờ VN): full (pgBackRest tự expire theo retention);
#      Chủ nhật thêm `verify` (đọc lại và kiểm checksum mọi tệp trong kho).
# /var/lib/pgbackrest/last-full giữ epoch kết thúc của bản sao lưu mới nhất **theo kho** (đọc từ
# `pgbackrest info`, không phải giờ container khởi động) — healthcheck: quá 26 giờ ⇒ unhealthy.
set -eu

AT="${BACKUP_FULL_AT_UTC:-19:00}"
MARK=/var/lib/pgbackrest/last-full
RAN=/var/lib/pgbackrest/last-run-date
log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

full() {
  log "full backup bắt đầu"
  pgbackrest backup --type=full
  date -u +%Y-%m-%d >"$RAN"
  refresh_mark
  log "full backup xong"
}

# Mốc kết thúc (epoch) của bản sao lưu mới nhất trong kho; "stop" của archive là chuỗi WAL nên không khớp.
refresh_mark() {
  pgbackrest info --output=json | grep -o '"stop":[0-9]*' | tail -n 1 | cut -d: -f2 >"$MARK"
}

until pg_isready -h "${PGBACKREST_PG1_SOCKET_PATH:-/var/run/postgresql}" -U "$PGBACKREST_PG1_USER" -q; do
  sleep 2
done
pgbackrest stanza-create
pgbackrest check
if pgbackrest info --output=json | grep -q '"type":"full"'; then
  refresh_mark
else
  full
fi

while true; do
  now="$(date -u +%H:%M)"
  today="$(date -u +%Y-%m-%d)"
  if [ "$now" = "$AT" ] && [ "$(cat "$RAN" 2>/dev/null || true)" != "$today" ]; then
    full
    if [ "$(date -u +%u)" = "7" ]; then
      log "verify kho bắt đầu"
      pgbackrest verify
      log "verify kho xong"
    fi
  fi
  sleep 30
done
