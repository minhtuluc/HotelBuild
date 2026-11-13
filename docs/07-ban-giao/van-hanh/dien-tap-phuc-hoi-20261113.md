# Biên bản diễn tập phục hồi: 13/11/2026 (máy dev, TC-SYS-07 bản cục bộ)

> **Phạm vi:** diễn tập trên máy dev của người thi công, chưa phải staging. Kho S3 là SeaweedFS 3.97 chạy trong cùng compose, TLS tự ký (`infra/prod/backup/s3.local.yml`). Biên bản này chứng minh cấu hình và quy trình chạy được. Nó **không** thay biên bản staging có người ký mà TC-SYS-07 yêu cầu (§6).

| Mục | Giá trị |
|---|---|
| Nhánh / ticket | `ticket/HB-179-sao-luu-phuc-hoi` (HB-179, phần hạ tầng) |
| Image | `pinehill/postgres:local` = `postgres:16-alpine` (PostgreSQL 16.16) + pgBackRest 2.58.0 |
| Kho | S3 `pinehill-backup/pinehill`, `aes-256-cbc`, zstd |
| Lệnh | `docker compose -p hb179drill --env-file <env> -f docker-compose.yml -f backup/s3.local.yml up -d postgres backup` → chạy `migrate` → runbook §4 |
| Người thực hiện | Claude (thi công); người ký: _chờ chủ dự án_ |

## 1. Sao lưu

- `00:30:56Z`: `stanza-create` thành công. `check` đẩy được đoạn WAL `…02` lên kho, và kho trả về được.
- `00:30:57Z → 00:30:59Z`: bản full `20261113-003057F`, CSDL 29,6 MB, trong kho chiếm 3,7 MB sau khi nén và mã hoá.
- Container `backup` báo `healthy`.
- `pgbackrest verify` (`00:34:23Z`): `completed successfully`.
- `pgbackrest info`: `status: ok`, `cipher: aes-256-cbc`, WAL `…01` → `…06`.
- **Kiểm mã hoá:** 7 chunk trong kho có header OpenSSL `Salted__`. Chuỗi dạng rõ duy nhất tìm thấy là **tên đối tượng** (`pg_control.zst`, `PG_VERSION.zst`) trong metadata của kho. Đây là giới hạn đã ghi ở runbook §2.
- **Lỗi archive lúc khởi động:** `pg_stat_archiver.failed_count = 5`, cả 5 lần nằm trong khoảng `00:30:50Z → 00:30:56Z`, tức trước khi stanza được tạo (lỗi `archive.info` missing). PostgreSQL đã thử lại và đẩy thành công; `archived_count = 7`, không mất đoạn nào.

## 2. Dữ liệu diễn tập

1. Ghi 100.000 dòng `drill.payload` (batch `A`) và mốc `before-T` lúc `00:32:41.98581Z`.
2. **T = `2026-11-13 00:32:42.071465+00`** (đồng hồ CSDL).
3. Ghi thêm 50.000 dòng (batch `B`) và mốc `after-T`, rồi chạy `pg_switch_wal()`. Nguồn lúc này có 150.000 dòng.

## 3. Phục hồi về T

**Lần 1: thất bại.** Lỗi `recovery aborted because of insufficient parameter settings: max_connections = 100 is a lower setting than on the primary server, where its value was 200`.
- Nguyên nhân: production đặt `max_connections=200` qua dòng lệnh compose, mà giá trị dòng lệnh không nằm trong `postgresql.conf` được sao lưu. Bản khôi phục khởi động với mặc định 100.
- **Đã sửa** trong `restore-drill.sh`: truyền `max_connections=${DRILL_MAX_CONNECTIONS:-200}` và ghi chú ở runbook. Lỗi này chỉ bị phát hiện nhờ diễn tập thật.

**Lần 2: thành công.**
- `restore backup set 20261113-003057F`, replay WAL `…03` → `…06`, `starting point-in-time recovery to 2026-11-13 00:32:42.071465+00`.
- Khi xong: `archive recovery complete`, `selected new timeline ID: 2`, `database system is ready to accept connections`.

| Kiểm | Kỳ vọng | Thực tế |
|---|---|---|
| Mốc trong `drill.markers` | chỉ `before-T` | `before-T \| 2026-11-13 00:32:41.98581+00` |
| `drill.payload` | 100.000 (batch B sau T phải mất) | **100000** |
| Bảng nghiệp vụ (`bookings`, `payments`, tổng tiền, `balance_due`, `room_assignments`) | khớp nguồn tại T (CSDL mới migrate, đều 0) | 0 / 0 / 0 / 0 / 0 |
| RTO (restore + replay tới T) | ≤ 4 giờ | **27 giây** (CSDL 29,6 MB) |
| RPO | ≤ 15 phút | Dữ liệu sau T mất đúng như thiết kế. Trong vận hành, RPO bị chặn trên bởi `archive_timeout=300` (≤ 5 phút) |

## 4. Dọn dẹp

`docker compose -p hb179drill --profile drill down -v`: xoá toàn bộ container và volume của project diễn tập riêng này.

## 5. Kết luận

Cấu hình sao lưu WAL liên tục + full, mã hoá, kiểm toàn vẹn và phục hồi PITR vào môi trường tạm đều **chạy được trên máy dev**. Quá trình diễn tập đã tìm ra và sửa một lỗi cấu hình phục hồi (`max_connections`).

## 6. Còn lại để đạt TC-SYS-07

- Diễn tập trên **staging thật**, với kho S3 off-site thật và dữ liệu nghiệp vụ có booking/thanh toán, rồi đối soát tiền và tồn. Việc này chờ chốt VPS và kho (QĐ-08).
- Biên bản staging cần có **người ký**.
