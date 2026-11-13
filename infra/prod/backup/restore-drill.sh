#!/bin/sh
# HB-179 — diễn tập phục hồi PITR (TC-SYS-07). Chạy trong container `restore-drill` (profile `drill`) trên
# volume **tạm** `restoredata`, KHÔNG chạm volume `pgdata` của production.
#   RESTORE_TARGET  thời điểm khôi phục (vd. "2026-11-13 09:30:00+07"); để trống ⇒ tới WAL cuối cùng trong kho.
#   RESTORE_SET     (tuỳ chọn) nhãn bản full làm gốc; mặc định pgBackRest tự chọn bản phù hợp target.
# Bản phục hồi chạy với archive_mode=off và không nghe TCP: không đẩy WAL ngược vào kho, không ai kết nối nhầm.
# In ra số liệu đối soát (đếm booking/payment, tổng tiền SUCCEEDED, mốc audit cuối) để so với nguồn.
set -eu

DATA="${PGDATA:-/var/lib/postgresql/data}"
log() { printf '%s drill: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
started="$(date +%s)"

if [ -n "$(ls -A "$DATA" 2>/dev/null)" ]; then
  log "volume tạm không rỗng — xoá để diễn tập lại từ đầu"
  find "$DATA" -mindepth 1 -delete
fi

set -- --archive-mode=off --pg1-path="$DATA"
if [ -n "${RESTORE_TARGET:-}" ]; then
  set -- "$@" --type=time "--target=$RESTORE_TARGET" --target-action=promote
fi
[ -n "${RESTORE_SET:-}" ] && set -- "$@" "--set=$RESTORE_SET"
log "restore: $*"
pgbackrest restore "$@"

# Tham số "nóng" phải ≥ bản gốc, nếu không PostgreSQL từ chối replay WAL ("insufficient parameter
# settings"). Production đặt max_connections=200 qua dòng lệnh compose (không nằm trong postgresql.conf được
# sao lưu) ⇒ truyền lại đúng giá trị ở đây; đổi trong compose thì đổi cả DRILL_MAX_CONNECTIONS.
pg_ctl -D "$DATA" -w -t 3600 \
  -o "-c listen_addresses='' -c archive_mode=off -c max_connections=${DRILL_MAX_CONNECTIONS:-200}" start
until [ "$(psql -h /var/run/postgresql -U "$PGBACKREST_PG1_USER" -d "${POSTGRES_DB:-pinehill}" -Atc 'SELECT pg_is_in_recovery()')" = "f" ]; do
  sleep 1
done
restored="$(date +%s)"

psql -h /var/run/postgresql -U "$PGBACKREST_PG1_USER" -d "${POSTGRES_DB:-pinehill}" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '── Đối soát sau phục hồi (so với nguồn tại cùng thời điểm) ──'
SELECT (SELECT count(*) FROM bookings)                                         AS bookings,
       (SELECT count(*) FROM payments)                                         AS payments,
       (SELECT coalesce(sum(amount), 0) FROM payments WHERE status = 'SUCCEEDED') AS payments_succeeded_vnd,
       (SELECT coalesce(sum(balance_due), 0) FROM bookings)                    AS balance_due_vnd,
       (SELECT count(*) FROM room_assignments)                                 AS room_assignments,
       (SELECT max(created_at) FROM audit_logs)                                AS last_audit_at;
SELECT to_regclass('drill.markers') IS NOT NULL AS has_markers \gset
\if :has_markers
\echo '── Mốc diễn tập (runbook bước 2–3) ──'
SELECT label, at FROM drill.markers ORDER BY at;
SELECT count(*) AS drill_payload_rows FROM drill.payload;
\endif
SQL

pg_ctl -D "$DATA" -m fast stop
log "RTO đo được: $((restored - started)) giây (restore + replay WAL tới target)"
