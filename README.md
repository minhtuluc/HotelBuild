# Pine Hill — hệ thống đặt phòng chuỗi khách sạn–homestay

Monorepo gồm **một backend chung** (API + worker) và bốn ứng dụng giao diện, cùng bộ tài liệu yêu cầu/thiết kế đã dùng để thi công.

| Thư mục | Vai trò |
| --- | --- |
| `apps/api` | API REST NestJS/Fastify, Prisma + PostgreSQL 16, Redis 7 |
| `apps/worker` | Job nền BullMQ: hết hạn hold, outbox, đồng bộ kênh, thông báo, quét quá tải, chi hoàn… |
| `apps/customer-web` | Web khách (Next.js, cổng 3001) |
| `apps/operations-web` | Web vận hành (Next.js, cổng 3002; BFF `app/api/session/**`) |
| `apps/customer-android`, `apps/operations-android` | Ứng dụng Expo/React Native |
| `packages/contracts` | Hợp đồng zod + OpenAPI (nguồn sự thật của API) |
| `packages/domain` | Engine thuần: giá, tồn, chính sách huỷ, chỉ số báo cáo |
| `packages/api-client`, `ui-web`, `ui-native`, `config` | Client API, UI dùng chung, cấu hình lint/TS |

Tài liệu: [bản đồ tài liệu](docs/README.md) · [quy tắc nghiệp vụ](docs/02-nghiep-vu/quy-tac-nghiep-vu.md) · [API](docs/04-thiet-ke/api.md) · [CSDL](docs/04-thiet-ke/csdl.md) · [ADR](docs/04-thiet-ke/adr/README.md) · [ma trận truy vết](docs/06-truy-vet/ma-tran-truy-vet.md) · [nợ kỹ thuật](docs/07-ban-giao/no-ky-thuat.md) · [vận hành](docs/07-ban-giao/van-hanh/) · [lộ trình đến deploy](docs/08-thi-cong/lo-trinh-den-deploy.md).

## Dựng trên máy sạch

Cần: **Node.js ≥ 22.13**, **pnpm 10.34.5** (`corepack enable` sẽ lấy đúng bản khai trong `package.json`), **Docker** có `docker compose`. Android cần thêm Android SDK/thiết bị — xem [van-hanh/android.md](docs/07-ban-giao/van-hanh/android.md).

```sh
git clone <repo> pine-hill && cd pine-hill
corepack enable
pnpm install --frozen-lockfile

cp .env.example .env              # chỉ dùng local; .env đã bị .gitignore chặn
# Hai khoá JWT để trống ở tệp mẫu — sinh ngẫu nhiên (chú thích trong .env.example):
sed -i "s#^JWT_ACCESS_SECRET=.*#JWT_ACCESS_SECRET=$(openssl rand -base64 48)#" .env
sed -i "s#^JWT_REFRESH_SECRET=.*#JWT_REFRESH_SECRET=$(openssl rand -base64 48)#" .env
pnpm infra:up                     # PostgreSQL 16 + Redis 7 + Mailpit, chờ healthy
set -a; . ./.env; set +a          # nạp biến vào shell hiện tại

pnpm migrate                      # migration bằng role chủ (DATABASE_MIGRATION_URL)
pnpm db:dev-roles                 # đặt mật khẩu login cho role runtime app_rw (chỉ dev)
SEED_DEV_PASSWORD='<mật khẩu dev>' pnpm db:seed   # 3 cơ sở, 55 phòng, 7 tài khoản dev (một mỗi vai trò)
```

Các dòng còn để trống trong `.env` (`EXPORT_DIR`, `NOTI_SMTP_*`, `OTEL_*`) nghĩa là "dùng mặc định/tắt". Nếu máy đã có môi trường dev khác dùng chung PostgreSQL/Redis, đổi tên CSDL trong hai URL và chỉ số DB của `REDIS_URL` (ví dụ `/5`) để worker không nhận job của môi trường kia.

Chi tiết cổng, `psql`, migration và mật khẩu runtime: [infra/README.md](infra/README.md). Danh mục biến môi trường: [van-hanh/bien-moi-truong.md](docs/07-ban-giao/van-hanh/bien-moi-truong.md).

### Chạy

Mỗi lệnh một terminal (đã nạp `.env`):

```sh
pnpm --filter @pinehill/api dev              # http://127.0.0.1:3000/api/v1  (health: /api/v1/system/health)
pnpm --filter @pinehill/worker dev           # job nền
pnpm --filter @pinehill/customer-web dev     # http://127.0.0.1:3001
pnpm --filter @pinehill/operations-web dev   # http://127.0.0.1:3002
```

Tài khoản dev do `db:seed` tạo: `owner`, `manager`, `frontdesk`, `housekeeping`, `reservation`, `accountant`, `sysadmin`, cùng mật khẩu `SEED_DEV_PASSWORD`. Production không dùng seed dev — tạo chủ chuỗi bằng `pnpm owner:bootstrap` ([go-live.md](docs/07-ban-giao/van-hanh/go-live.md)).

## Kiểm tra

| Lệnh | Phạm vi |
| --- | --- |
| `pnpm run ci` | Cổng của mọi PR: phạm vi ticket, OpenAPI/hợp đồng, import, typecheck, lint, test đơn vị, build |
| `pnpm test:integration` | Integration API + worker trên PostgreSQL 16/Redis 7 thật (cần `DATABASE_MIGRATION_URL`, `REDIS_URL`) |
| `pnpm db:drift` | `schema.prisma` khớp chuỗi migration |
| `pnpm test:e2e` | Playwright cho hai web |
| `npm run check` | Liên kết/anchor Markdown, Mermaid, mã yêu cầu và truy vết của tài liệu |
| `node tests/load/chay-cuc-bo.mjs` | Tải k6 cục bộ (podman/docker) — [van-hanh/tai-k6.md](docs/07-ban-giao/van-hanh/tai-k6.md) |

Quy trình thi công (một ticket một nhánh `ticket/HB-nnn-slug`, đặc tả trong `docs/08-thi-cong/tickets/`, test khoá `*.locked.*` không được sửa): [docs/08-thi-cong/README.md](docs/08-thi-cong/README.md).

Không chạy DDL mẫu trong tài liệu vào cơ sở dữ liệu đang vận hành; triển khai chỉ qua migration đã review ([van-hanh/migration.md](docs/07-ban-giao/van-hanh/migration.md)).
