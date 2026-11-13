# Sao lưu và phục hồi PostgreSQL (HB-179)

**Mục tiêu (NFR-REL-04, BR-SYS-03):** mất tối đa 15 phút dữ liệu (RPO) và khôi phục xong trong vòng 4 giờ (RTO). Biên bản diễn tập lưu ở `dien-tap-phuc-hoi-<ngày>.md` (TC-SYS-07).

## 1. Kiến trúc

| Thành phần | Vai trò |
|---|---|
| Image `docker/postgres.Dockerfile` | `postgres:16-alpine` + pgBackRest 2.58. Dùng chung cho `postgres`, `backup` và `restore-drill` |
| `postgres` | `archive_mode=on`, `archive_command=pgbackrest archive-push %p`, `archive_timeout=300`: mỗi đoạn WAL được đẩy lên kho ngay khi đầy, và cứ 5 phút ép đổi đoạn mới nếu có ghi |
| `backup` (sidecar) | Lúc khởi động chạy `stanza-create` + `check`. Có bản full đầu tiên ngay khi kho còn trống, sau đó full hằng ngày lúc **02:00 giờ VN** (`BACKUP_FULL_AT_UTC=19:00`) và `verify` mỗi Chủ nhật. Healthcheck đọc mốc kết thúc của bản mới nhất **trong kho**: quá 26 giờ thì `unhealthy` |
| `restore-drill` (profile `drill`) | Khôi phục PITR vào volume tạm `restoredata` với `archive_mode=off`, không nghe TCP, rồi in số liệu đối soát và RTO. **Không** chạm `pgdata` |
| Kho | S3-compatible, **off-site**: khác nhà cung cấp hoặc khác vùng với VPS. Mã hoá `aes-256-cbc` phía máy bằng `BACKUP_CIPHER_PASS`, nén zstd. Mặc định giữ 14 bản full (`BACKUP_RETENTION_FULL`); WAL cũ hơn bản full cũ nhất tự bị xoá |

**RPO:**
- Khi có ghi: tối đa khoảng 5 phút (`archive_timeout`). Trường hợp xấu nhất là VPS mất hẳn đúng lúc một đoạn WAL chưa đẩy xong.
- Khi kho S3 tạm sập: `archive_command` báo lỗi, PostgreSQL **giữ WAL trên đĩa và thử lại**, không mất dữ liệu. Nhưng nếu kho sập lâu thì đĩa sẽ đầy dần; theo dõi `pg_stat_archiver.failed_count` (§5).

## 2. Cấu hình (`infra/prod/.env`)

| Biến | Ý nghĩa |
|---|---|
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_PORT` (443), `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PATH` (`/pinehill`) | Kho S3. Bucket phải tạo trước, nên bật versioning hoặc object lock nếu nhà cung cấp hỗ trợ |
| `BACKUP_S3_KEY`, `BACKUP_S3_KEY_SECRET` | Khoá truy cập **chỉ cho bucket này** (quyền đọc/ghi/xoá đối tượng), không dùng khoá root của tài khoản |
| `BACKUP_S3_URI_STYLE` | `host` (mặc định, AWS và đa số nhà cung cấp) hoặc `path` (SeaweedFS/MinIO tự dựng) |
| `BACKUP_S3_VERIFY_TLS` | `y`. Chỉ đặt `n` cho kho tự ký trên máy dev |
| `BACKUP_CIPHER_PASS` | Khoá mã hoá kho: `openssl rand -base64 48` |
| `BACKUP_RETENTION_FULL` | Số bản full giữ lại (14 bản ≈ 14 ngày cửa sổ PITR) |
| `BACKUP_FULL_AT_UTC` | Giờ chạy full hằng ngày theo UTC (mặc định `19:00`) |

### Cất giữ `BACKUP_CIPHER_PASS`

> **Mất khoá này là mất toàn bộ bản sao lưu.** Kho chỉ chứa dữ liệu đã mã hoá, và không ai, kể cả nhà cung cấp, giải mã được nếu không có khoá.

- Cất ở ít nhất **hai nơi ngoài VPS**, ví dụ trình quản lý mật khẩu của chủ dự án và một bản giấy niêm phong.
- Đổi khoá phải tạo stanza mới, vì bản cũ chỉ giải mã được bằng khoá cũ. Giữ khoá cũ cho tới khi các bản cũ hết hạn.

### Những gì kho thấy được

Nội dung tệp được mã hoá. Tuy vậy **tên đối tượng** vẫn lộ ra dạng rõ (vd. `pg_data/global/pg_control.zst`): người có quyền đọc bucket thấy được bố cục thư mục PostgreSQL và kích thước tệp, nhưng không thấy dữ liệu.

## 3. Vận hành hằng ngày

```sh
cd infra/prod
docker compose --env-file .env ps backup                    # healthy
docker compose --env-file .env exec backup pgbackrest info   # danh sách bản full + khoảng WAL
docker compose --env-file .env logs --since 26h backup       # full/verify gần nhất
docker compose --env-file .env exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'SELECT archived_count, failed_count, last_archived_time, last_failed_time FROM pg_stat_archiver'
```

Lúc stack khởi động **lần đầu**, `pg_stat_archiver.failed_count` có thể có vài lỗi. Nguyên nhân: PostgreSQL đẩy WAL trước khi sidecar kịp tạo stanza (lỗi `archive.info` missing). Các đoạn này được thử lại và đẩy thành công sau đó. Chỉ đáng lo khi `last_failed_time` **mới hơn** `last_archived_time`.

## 4. Diễn tập phục hồi (TC-SYS-07): ít nhất mỗi quý và sau mỗi lần đổi hạ tầng

Chạy trên staging. Trên production cũng chạy được: `restore-drill` chỉ đọc kho và ghi vào volume tạm.

1. **Đánh dấu dữ liệu trước mốc T:**
   ```sh
   docker compose --env-file .env exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
   CREATE SCHEMA IF NOT EXISTS drill;
   CREATE TABLE IF NOT EXISTS drill.markers(label text PRIMARY KEY, at timestamptz NOT NULL DEFAULT clock_timestamp());
   CREATE TABLE IF NOT EXISTS drill.payload(id bigserial PRIMARY KEY, batch text NOT NULL, body text NOT NULL);
   INSERT INTO drill.payload(batch, body) SELECT 'A', md5(g::text) FROM generate_series(1,100000) g;
   INSERT INTO drill.markers(label) VALUES ('before-T');
   SQL
   ```
2. **Ghi lại T** (đồng hồ CSDL, UTC):
   `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')||'+00';`
   Ghi thêm số liệu đối soát của nguồn tại T: đếm `bookings`/`payments`, tổng `payments` SUCCEEDED, tổng `balance_due`. Đây chính là các cột mà `restore-drill` in ra.
3. **Ghi dữ liệu sau T** (phải mất sau khi phục hồi), rồi ép đẩy WAL:
   `INSERT INTO drill.payload … 'B' …; INSERT INTO drill.markers(label) VALUES ('after-T'); SELECT pg_switch_wal();`
4. **Phục hồi về T vào volume tạm:**
   ```sh
   RESTORE_TARGET='<T>' docker compose --env-file .env --profile drill run --rm restore-drill
   ```
5. **Kiểm kết quả:**
   - chỉ còn mốc `before-T`;
   - `drill_payload_rows = 100000`;
   - số liệu đối soát khớp bước 2;
   - dòng `RTO đo được: … giây`.
6. **Dọn dẹp:**
   - `docker volume rm <project>_restoredata`;
   - `DROP SCHEMA drill CASCADE` trên nguồn.
7. **Ghi biên bản** `dien-tap-phuc-hoi-<ngày>.md`: T, RPO, RTO, số liệu đối soát, người thực hiện và người ký.

## 5. Phục hồi khi có sự cố thật (mất dữ liệu, xoá nhầm, hỏng đĩa)

1. **Chặn ghi mới:** `docker compose stop api worker`. Caddy vẫn chạy và sẽ trả 502 cho khách.
2. **Chọn T:** ngay trước sự cố, đọc từ `audit_logs` hoặc log ứng dụng. Nếu mất cả VPS thì để trống `RESTORE_TARGET`, khi đó dữ liệu khôi phục tới đoạn WAL cuối cùng có trong kho.
3. **Khôi phục vào volume tạm** như §4 bước 4, rồi kiểm số liệu.
4. **Đổi volume.** Giữ nguyên volume hỏng để điều tra, không xoá:
   ```sh
   docker compose stop postgres backup
   docker run --rm -v <project>_pgdata:/from -v <project>_pgdata_hong_<ngày>:/to alpine cp -a /from/. /to/
   docker run --rm -v <project>_restoredata:/from -v <project>_pgdata:/to alpine sh -c 'rm -rf /to/* && cp -a /from/. /to/'
   docker compose up -d postgres backup && docker compose up -d api worker
   ```
   Khi `postgres` khởi động lại với `archive_mode=on`, timeline mới sẽ được đẩy lên kho. Chạy ngay một bản full: `docker compose exec backup pgbackrest backup --type=full`.
5. **Đối soát sau khôi phục:**
   - **Tiền:** chạy `reconciliation/daily` cho ngày bị ảnh hưởng, và đối chiếu giao dịch PSP sau T với cổng VNPay/MoMo. Callback đến sau T sẽ được PSP gửi lại hoặc tra lại bằng `payments/{id}/status`.
   - **Tồn:** kiểm `GET /inventory/grid` và chạy quét quá tải.
   - **OTA:** booking OTA nhận sau T cần đồng bộ lại.

## 6. Giới hạn hiện tại

- **Chưa có cảnh báo tự động.** Trạng thái `backup` unhealthy và `pg_stat_archiver.failed_count` cần được nối vào cảnh báo (HB-182). Trước khi việc đó xong, kiểm thủ công theo §3.
- **Chưa có `POST /system/backups`** (yêu cầu sao lưu hoặc diễn tập qua API, api.md §2.13). Phần này tách thành việc riêng; hiện thao tác bằng compose như trên.
- **Chưa diễn tập trên staging thật**, vì chưa chốt VPS và kho S3 (QĐ-08). Biên bản hiện có là diễn tập trên máy dev, dùng SeaweedFS làm kho (`backup/s3.local.yml`).
