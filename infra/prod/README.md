# Production/staging trên một VPS (HB-175, QĐ-08)

Một `docker compose` gồm 8 dịch vụ:

| Dịch vụ                          | Image                             | Ra ngoài?   | Ghi chú                                                                                                                                                  |
| -------------------------------- | --------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caddy`                          | `caddy:2.10-alpine`               | **80, 443** | TLS (Let's Encrypt), HSTS, HTTP→HTTPS, reverse proxy theo host                                                                                           |
| `api`                            | `docker/api.Dockerfile`           | không       | `TRUST_PROXY_HOPS=1` (tin đúng hop Caddy, TD-71)                                                                                                         |
| `worker`                         | `docker/worker.Dockerfile`        | không       | job nền BullMQ; `ENABLE_REPEATABLE_SCHEDULERS=true`                                                                                                      |
| `customer-web`, `operations-web` | `docker/web.Dockerfile` (`APP=…`) | không       | Next.js standalone                                                                                                                                       |
| `migrate`                        | `docker/migrate.Dockerfile`       | không       | chạy một lần: `scripts/migrate.mjs` + đặt mật khẩu `app_rw` ([runtime-role.mjs](runtime-role.mjs)); api/worker chỉ khởi động khi bước này **thành công** |
| `postgres`                       | `postgres:16-alpine`              | không       | volume `pgdata`, `wal_level=replica` (PITR: HB-179)                                                                                                      |
| `redis`                          | `redis:7.4-alpine`                | không       | AOF, có mật khẩu, volume `redisdata`                                                                                                                     |

## Chuẩn bị VPS (một lần)

1. Ubuntu/Debian LTS, ≥ 4 vCPU / 8 GB RAM / 160 GB SSD; cài Docker Engine + plugin compose.
2. Tường lửa: chỉ mở 22 (SSH, nên giới hạn IP), 80, 443 (TCP + UDP cho HTTP/3).
3. DNS: ba bản ghi A/AAAA (`API_HOST`, `OPS_HOST`, `CUSTOMER_HOST`) trỏ về VPS **trước** lần chạy đầu, để Let's Encrypt cấp được chứng chỉ.
4. Lấy mã nguồn (hoặc chỉ thư mục `infra/prod` nếu dùng image GHCR), rồi tạo `.env`:

```sh
cp infra/prod/.env.prod.example infra/prod/.env && chmod 600 infra/prod/.env
# điền host, CADDY_GLOBAL_OPTIONS="email ops@<miền>", và sinh bí mật:
openssl rand -hex 24   # POSTGRES_PASSWORD, APP_RW_PASSWORD, REDIS_PASSWORD (mỗi biến một lần)
openssl rand -base64 48  # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
```

Thiếu biến bắt buộc ⇒ `docker compose` dừng ngay với tên biến (`${VAR:?}`); api/worker cũng tự kiểm cấu hình và không khởi động khi sai.

## Dựng / cập nhật (một lệnh)

```sh
cd infra/prod
docker compose --env-file .env up -d --build      # build tại chỗ từ mã nguồn
# hoặc với image đã phát hành (HB-177):
IMAGE_REGISTRY=ghcr.io/<org>/pinehill IMAGE_TAG=<sha> docker compose --env-file .env pull
IMAGE_REGISTRY=ghcr.io/<org>/pinehill IMAGE_TAG=<sha> docker compose --env-file .env up -d
```

Thứ tự tự động: `postgres`/`redis` healthy → `migrate` chạy xong (exit 0) → `api`, `worker`, hai web → `caddy` khi api và hai web healthy.

Lần đầu, tạo chủ chuỗi. Không dùng seed dev trên production:

```sh
docker compose --env-file .env run --rm api node dist/cli/bootstrap-owner.js
```

## Kiểm sau khi dựng

```sh
docker compose --env-file .env ps                         # mọi dịch vụ healthy, migrate "exited (0)"
curl -sS https://$API_HOST/api/v1/system/health           # {"status":"ok"}
curl -sSI https://$OPS_HOST | grep -i strict-transport    # HSTS
docker compose --env-file .env logs --since 10m api worker
```

## Staging trên máy dev (không cần miền)

`.env` với `API_HOST=api.localhost`, `OPS_HOST=ops.localhost`, `CUSTOMER_HOST=book.localhost`, `CADDY_GLOBAL_OPTIONS=local_certs`, `WEB_EXTRA_CA_CERTS=/extra-ca/root.crt`. Caddy dùng CA nội bộ. BFF của hai web gọi API qua `https://API_HOST` nên phải tin CA đó. Sau lần `up` đầu:

````sh
mkdir -p ca && docker compose --env-file .env cp caddy:/data/caddy/pki/authorities/local/root.crt ca/root.crt
docker compose --env-file .env restart customer-web operations-web
curl --cacert ca/root.crt https://api.localhost/api/v1/system/health
``` Biên bản lượt dựng: [bang-chung-staging-local.md](../../docs/07-ban-giao/van-hanh/bang-chung-staging-local.md).

## Dừng, dữ liệu, gỡ

- `docker compose --env-file .env down` giữ nguyên volume (dữ liệu còn).
- **Không** chạy `down -v` trên production: lệnh này xoá `pgdata`.
- Sao lưu và khôi phục: HB-179 (WAL + full off-site, mã hoá). Trước khi HB-179 xong, **chưa** có backup tự động.
- Rollback: chạy lại lệnh `up -d` với `IMAGE_TAG` cũ. Migration chỉ tiến, không có `down` ([migration.md](../../docs/07-ban-giao/van-hanh/migration.md)). Runbook đầy đủ ở HB-180.
````
