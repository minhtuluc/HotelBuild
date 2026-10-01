# Hạ tầng phát triển local

`infra/docker-compose.yml` dựng đúng bộ phụ thuộc backend cần khi chạy trên máy: **PostgreSQL 16**, **Redis 7** và **Mailpit** (SMTP giả). Đây là vế dev của US-INF-01; cấu hình tương đương ở môi trường vận hành nằm tại [kiến trúc §7](../docs/04-thiet-ke/kien-truc.md).

## Chạy

```sh
cp .env.example .env     # lần đầu; .gitignore đã chặn .env
pnpm infra:up            # = docker compose -f infra/docker-compose.yml up -d --wait
docker compose -f infra/docker-compose.yml ps
```

`pnpm infra:up` chỉ trả về khi cả ba dịch vụ đã `healthy`. Dừng mà **giữ nguyên dữ liệu**:

```sh
pnpm infra:down          # = docker compose -f infra/docker-compose.yml down (không -v)
```

## Cổng

Mọi cổng chỉ bind vào loopback, không phơi ra mạng LAN.

| Dịch vụ | Cổng | Ghi chú |
|---|---|---|
| PostgreSQL 16 | `127.0.0.1:5432` | role chủ `pinehill`, CSDL `pinehill` (mặc định dev) |
| Redis 7 | `127.0.0.1:6379` | cache, khoá phân tán, idempotency (ADR-004) |
| Mailpit SMTP | `127.0.0.1:1025` | giá trị của `SMTP_URL` trong `.env` |
| Mailpit UI | `127.0.0.1:8025` | xem thư đã gửi |

## Kết nối `psql`

Máy có sẵn `psql`:

```sh
psql "$DATABASE_MIGRATION_URL" -c "select version()"
```

Máy không có `psql` (hoặc muốn chắc chắn đi qua đúng container), dùng client trong image:

```sh
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U pinehill -d pinehill -c "select version()"
```

> Role runtime `app_rw` (`DATABASE_URL`) **chưa tồn tại** ở bước này — migration baseline tạo role đó (HB-005). Trước HB-005, kiểm tra kết nối bằng `DATABASE_MIGRATION_URL` (role chủ).

## Xoá dữ liệu

```sh
docker compose -f infra/docker-compose.yml down -v
```

> ⚠️ **`-v` xoá vĩnh viễn volume `pinehill-postgres-data`** — toàn bộ CSDL dev, không khôi phục được. Chỉ dùng khi muốn dựng lại từ đầu. `pnpm infra:down` (không `-v`) giữ nguyên dữ liệu.

## Đổi mật khẩu / cấu hình

Mọi giá trị trong `docker-compose.yml` chỉ là mặc định **dành cho dev**; không có bí mật thật trong repo (NFR-SEC-06).

Biến nội suy của compose (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) lấy từ **biến môi trường của shell**. Compose đọc `.env` theo thư mục project (tức `infra/.env`), **không** đọc `.env` ở gốc — tệp gốc đó dành cho `apps/api`/`apps/worker` đọc lúc khởi động. Vì vậy muốn đổi mặc định của container, truyền qua shell:

```sh
POSTGRES_PASSWORD=matkhau_khac pnpm infra:up
```

Mặc định trong `docker-compose.yml` khớp với `.env.example` ở gốc, nên chạy mặc định là đủ cho dev. Lưu ý: đổi mật khẩu trên một volume đã khởi tạo **không** có tác dụng — phải tạo lại volume (`down -v`).

## Ngoài phạm vi tệp này

Tạo role/bảng (HB-005), Dockerfile cho `api`/`worker` (HB-006), job CI backend (HB-007).
