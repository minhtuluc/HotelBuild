#!/bin/sh
# HB-179 — sidecar sao lưu. Chạy trong container `backup` (user postgres), dùng chung volume dữ liệu
# (chỉ đọc) và socket với container `postgres`.
#   1. Chờ PostgreSQL sẵn sàng → `stanza-create` (idempotent) → `check` (chứng minh archive_command đẩy được
#      WAL lên kho, giải mã được) — sai cấu hình kho/khoá thì container dừng ngay, không im lặng.
#   2. Chưa có bản full nào ⇒ sao lưu full ngay (có điểm khôi phục từ phút đầu).
#   3. Mỗi ngày lúc BACKUP_FULL_AT_UTC (mặc định 19:00 UTC = 02:00 giờ VN): full (pgBackRest tự expire theo retention);
#      Chủ nhật thêm `verify` (đọc lại và kiểm checksum mọi tệp trong kho).
#   4. HB-246: mỗi vòng (30 giây) giành **một** yêu cầu `BACKUP`/`RESTORE_DRILL` từ bảng `operations` (API ghi),
#      chạy rồi chốt `SUCCEEDED` + `result_json` hoặc `FAILED` + `error_code`. Ảnh chụp `pgbackrest info` ghi vào
#      `backup_catalog` sau mỗi lần sao lưu và mỗi 5 phút để API/SCR-18 đọc.
# /var/lib/pgbackrest/last-full giữ epoch kết thúc của bản sao lưu mới nhất **theo kho** (đọc từ
# `pgbackrest info`, không phải giờ container khởi động) — healthcheck: quá 26 giờ ⇒ unhealthy.
set -eu

AT="${BACKUP_FULL_AT_UTC:-19:00}"
MARK=/var/lib/pgbackrest/last-full
RAN=/var/lib/pgbackrest/last-run-date
SOCK="${PGBACKREST_PG1_SOCKET_PATH:-/var/run/postgresql}"
DB="${POSTGRES_DB:-pinehill}"
DRILL_DATA="${DRILL_DATA_DIR:-/var/lib/pinehill-drill/data}"
log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
q() { psql -h "$SOCK" -U "$PGBACKREST_PG1_USER" -d "$DB" -v ON_ERROR_STOP=1 -qAtX "$@"; }

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
  refresh_catalog
}

# Ảnh chụp kho cho API. Bảng chưa có (migration chưa chạy tới 0015) thì bỏ qua, không làm chết sidecar.
refresh_catalog() {
  info="$(pgbackrest info --output=json 2>/dev/null)" || return 0
  printf '%s\n' "INSERT INTO backup_catalog(id, info_json, refreshed_at) VALUES (1, :'info'::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET info_json = EXCLUDED.info_json, refreshed_at = now();" |
    q -v info="$info" >/dev/null 2>&1 || log "chưa ghi được backup_catalog (bảng chưa có?)"
  date +%s >/tmp/pinehill-catalog-at
}

# Giành một yêu cầu đang chờ: "id|kind|mode|backupId|targetTimestamp" hoặc chuỗi rỗng.
claim() {
  q <<'SQL' 2>/dev/null || true
UPDATE operations SET status = 'RUNNING', started_at = now()
 WHERE id = (SELECT id FROM operations
              WHERE kind IN ('BACKUP','RESTORE_DRILL') AND status = 'PENDING'
              ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id || '|' || kind || '|' || coalesce(payload_json->>'mode', '') || '|'
       || coalesce(payload_json->>'backupId', '') || '|' || coalesce(payload_json->>'targetTimestamp', '');
SQL
}

succeed() { # id result_json
  printf '%s\n' "UPDATE operations SET status = 'SUCCEEDED', finished_at = now(), result_json = :'result'::jsonb
    WHERE id = :'id'::uuid AND status = 'RUNNING';" | q -v id="$1" -v result="$2"
}

fail() { # id error_code message
  printf '%s\n' "UPDATE operations SET status = 'FAILED', finished_at = now(), error_code = :'code',
      error_message = left(:'message', 500) WHERE id = :'id'::uuid AND status = 'RUNNING';" |
    q -v id="$1" -v code="$2" -v message="$3"
}

# Thông báo lỗi cho người vận hành: dòng ERROR cuối của pgBackRest/PostgreSQL, không phải cả log.
reason() { grep -E 'ERROR|FATAL' "$1" | tail -n 2 | tr '\n' ' ' | cut -c1-500; }

run_backup() { # id mode
  case "$2" in
    FULL) type=full ;;
    *) type=incr ;; # PITR: gia tăng trên bản full gần nhất (pgBackRest tự nâng lên full nếu chưa có)
  esac
  log "yêu cầu $1: backup --type=$type"
  if pgbackrest backup --type="$type" >/tmp/pinehill-op.log 2>&1; then
    refresh_mark
    label="$(pgbackrest info --output=json | grep -o '"label":"[^"]*"' | tail -n 1 | cut -d'"' -f4)"
    succeed "$1" "{\"backupId\":\"$label\",\"type\":\"$type\"}"
    log "yêu cầu $1 xong: $label"
  else
    fail "$1" E_SYS_BACKUP_FAILED "$(reason /tmp/pinehill-op.log)"
    log "yêu cầu $1 thất bại"
  fi
}

run_drill() { # id backupId targetTimestamp
  # Dữ liệu từ CSDL nhưng vẫn kiểm lại dạng trước khi thành tham số dòng lệnh (phòng thủ hai lớp).
  if ! printf '%s' "$2" | grep -Eq '^[0-9]{8}-[0-9]{6}F(_[0-9]{8}-[0-9]{6}[DI])?$' ||
    ! printf '%s' "$3" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$'; then
    fail "$1" E_GEN_VALIDATION_FAILED "Tham số diễn tập sai dạng."
    return 0
  fi
  log "yêu cầu $1: diễn tập từ $2 tới $3"
  rm -f /tmp/pinehill-drill.json
  # `recovery_target_time` của PostgreSQL không nhận dạng ISO `…T…Z` ⇒ đổi sang `YYYY-MM-DD HH:MM:SS+00`.
  target="$(printf '%s' "$3" | sed 's/T/ /; s/Z$/+00/')"
  # Socket/cổng riêng: sidecar dùng chung /var/run/postgresql với production, bản phục hồi không được đụng.
  if PGDATA="$DRILL_DATA" RESTORE_SET="$2" RESTORE_TARGET="$target" DRILL_TARGET_LABEL="$3" DRILL_SOCKET_DIR=/tmp/pinehill-drill-sock \
    DRILL_PORT=5433 DRILL_RESULT_FILE=/tmp/pinehill-drill.json DRILL_CLEANUP=1 \
    /usr/local/bin/pinehill-restore-drill >/tmp/pinehill-op.log 2>&1 && [ -s /tmp/pinehill-drill.json ]; then
    succeed "$1" "$(cat /tmp/pinehill-drill.json)"
    log "yêu cầu $1 xong: $(cat /tmp/pinehill-drill.json)"
  else
    fail "$1" E_SYS_RESTORE_DRILL_FAILED "$(reason /tmp/pinehill-op.log)"
    log "yêu cầu $1 thất bại"
  fi
}

# Chỉ có một sidecar: thao tác còn RUNNING lúc khởi động là của lượt trước bị ngắt (container restart, OOM…).
# Chốt FAILED để chỉ mục "một việc nặng mỗi lúc" không bị kẹt vĩnh viễn; người vận hành yêu cầu lại.
recover() {
  q <<'SQL' 2>/dev/null || log "chưa dọn được thao tác dở (bảng operations chưa có loại sao lưu?)"
UPDATE operations SET status = 'FAILED', finished_at = now(), error_code = 'E_SYS_BACKUP_INTERRUPTED',
       error_message = 'Sidecar sao lưu khởi động lại khi thao tác đang chạy; hãy yêu cầu lại.'
 WHERE kind IN ('BACKUP','RESTORE_DRILL') AND status = 'RUNNING';
SQL
}

handle_requests() {
  job="$(claim)"
  [ -n "$job" ] || return 0
  id="$(printf '%s' "$job" | cut -d'|' -f1)"
  kind="$(printf '%s' "$job" | cut -d'|' -f2)"
  if [ "$kind" = BACKUP ]; then
    run_backup "$id" "$(printf '%s' "$job" | cut -d'|' -f3)"
  else
    run_drill "$id" "$(printf '%s' "$job" | cut -d'|' -f4)" "$(printf '%s' "$job" | cut -d'|' -f5)"
  fi
}

until pg_isready -h "$SOCK" -U "$PGBACKREST_PG1_USER" -q; do
  sleep 2
done
pgbackrest stanza-create
pgbackrest check
recover
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
  handle_requests
  if [ $(($(date +%s) - $(cat /tmp/pinehill-catalog-at 2>/dev/null || echo 0))) -ge 300 ]; then
    refresh_catalog
  fi
  sleep 30
done
