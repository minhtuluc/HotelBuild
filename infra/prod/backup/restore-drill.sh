#!/bin/sh
# HB-179 — diễn tập phục hồi PITR (TC-SYS-07) vào volume **tạm**, KHÔNG chạm volume `pgdata` của production.
# Hai cách chạy:
#   - tay: container `restore-drill` (profile `drill`), như runbook;
#   - theo yêu cầu API (HB-246): sidecar `backup` gọi script này cho thao tác `RESTORE_DRILL`.
# Biến:
#   RESTORE_TARGET     thời điểm khôi phục (vd. "2026-11-13 09:30:00+07"); trống ⇒ tới WAL cuối cùng trong kho.
#   RESTORE_SET        (tuỳ chọn) nhãn bản sao lưu làm gốc; mặc định pgBackRest tự chọn bản phù hợp target.
#   DRILL_SOCKET_DIR   thư mục socket của bản phục hồi (mặc định /var/run/postgresql). Sidecar `backup` dùng
#                      chung /var/run/postgresql với production nên PHẢI truyền thư mục riêng.
#   DRILL_PORT         cổng (chỉ dùng để đặt tên socket, không nghe TCP); mặc định 5432.
#   DRILL_RESULT_FILE  (tuỳ chọn) ghi biên bản JSON (RTO, số dòng đối soát) cho thao tác API.
#   DRILL_TARGET_LABEL (tuỳ chọn) mốc ghi vào biên bản (ISO UTC như API nhận); mặc định = RESTORE_TARGET.
#   DRILL_CLEANUP=1    xoá dữ liệu đã phục hồi sau khi đo (giải phóng đĩa trên VPS).
# Bản phục hồi chạy với archive_mode=off và không nghe TCP: không đẩy WAL ngược vào kho, không ai kết nối nhầm.
set -eu

DATA="${PGDATA:-/var/lib/postgresql/data}"
SOCK="${DRILL_SOCKET_DIR:-/var/run/postgresql}"
PORT="${DRILL_PORT:-5432}"
DB="${POSTGRES_DB:-pinehill}"
log() { printf '%s drill: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
sql() { psql -h "$SOCK" -p "$PORT" -U "$PGBACKREST_PG1_USER" -d "$DB" -v ON_ERROR_STOP=1 "$@"; }
started="$(date +%s)"
running=0

stop() {
  if [ "$running" = 1 ]; then
    pg_ctl -D "$DATA" -m fast stop >/dev/null 2>&1 || true
    running=0
  fi
  if [ "${DRILL_CLEANUP:-0}" = 1 ]; then find "$DATA" -mindepth 1 -delete 2>/dev/null || true; fi
}
trap stop EXIT

if [ -n "$(ls -A "$DATA" 2>/dev/null)" ]; then
  log "volume tạm không rỗng — xoá để diễn tập lại từ đầu"
  find "$DATA" -mindepth 1 -delete
fi
mkdir -p "$SOCK"

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
  -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -c port=$PORT -c archive_mode=off -c max_connections=${DRILL_MAX_CONNECTIONS:-200}" start
running=1
until [ "$(sql -Atc 'SELECT pg_is_in_recovery()')" = "f" ]; do
  sleep 1
done
restored="$(date +%s)"
rto=$((restored - started))

if [ -n "${DRILL_RESULT_FILE:-}" ]; then
  # Biên bản cho API: chỉ số đếm và mốc thời gian — không có PII, không có số tiền.
  sql -qAtX -v rto="$rto" -v set="${RESTORE_SET:-}" -v target="${DRILL_TARGET_LABEL:-${RESTORE_TARGET:-}}" >"$DRILL_RESULT_FILE" <<'SQL'
SELECT json_build_object(
  'backupId', nullif(:'set', ''),
  'targetTimestamp', nullif(:'target', ''),
  'rtoSeconds', :'rto'::int,
  'rows', json_build_object(
    'bookings', (SELECT count(*) FROM bookings),
    'payments', (SELECT count(*) FROM payments),
    'roomAssignments', (SELECT count(*) FROM room_assignments),
    'auditLogs', (SELECT count(*) FROM audit_logs)),
  'lastAuditAt', (SELECT to_char(max(at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM audit_logs));
SQL
else
  sql -P pager=off <<'SQL'
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
fi

stop
log "RTO đo được: ${rto} giây (restore + replay WAL tới target)"
