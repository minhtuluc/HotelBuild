# Bằng chứng dựng staging bằng compose production (HB-175)

**Ngày:** 11/11/2026 · **Người chạy:** Claude · **Mã:** `main` d3e9963 + nhánh HB-175 · **Máy:** máy dev Fedora (Docker Engine), host `*.localhost`, Caddy `local_certs`. Đây **không** phải VPS thật. Lượt trên VPS chờ chủ dự án cấp máy và tên miền (QĐ-08 mục 5, 8).

## Lệnh

```sh
cd infra/prod && docker compose --env-file .env up -d --build
```

5 image build thành công: api 725 MB, worker 551 MB, customer-web 330 MB, operations-web 338 MB, migrate 1,05 GB.

## Kết quả

| Kiểm | Kết quả |
| --- | --- |
| Thứ tự khởi động | postgres/redis healthy → `migrate` exit 0 → api/worker/2 web healthy → caddy |
| Deploy lại (`up -d` lần hai, rồi `down` + `up -d`) | `migrate` exit 0 (idempotent); dữ liệu còn; toàn bộ stack dựng lại trong 15 giây |
| `GET https://api.localhost/api/v1/system/health` | `{"status":"ok"}` (sau sửa probe Redis có mật khẩu) |
| Header `https://ops.localhost` | `strict-transport-security: max-age=31536000; includeSubDomains`, `x-content-type-options: nosniff`, `x-frame-options: DENY` |
| `http://book.localhost` | `308` → `https://book.localhost/` |
| Hai web | `https://book.localhost/` 200, `https://ops.localhost/` 200 |
| Cổng ra host | chỉ 80/443 (caddy). PostgreSQL/Redis/api/web không publish cổng nào |
| Giả IP qua `X-Forwarded-For` (TD-71) | 125 lệnh tra tồn công khai, mỗi lệnh một XFF ngẫu nhiên ⇒ **120 phục vụ, 5 × 429**: hạn mức tính theo IP thật, header giả bị bỏ qua |
| OWNER đầu tiên | `docker compose run --rm api node dist/cli/bootstrap-owner.js` ⇒ tạo được, phải đổi mật khẩu lần đầu. Chạy lại ⇒ exit 1 "Đã có OWNER đang hoạt động" |
| Đăng nhập | `POST https://api.localhost/api/v1/auth/login` 200. BFF `POST https://ops.localhost/api/session/login` 200, cookie `Secure; HttpOnly; SameSite=Strict` |

## Lỗi tìm ra khi dựng (đã sửa trong HB-175)

1. **Probe Redis không `AUTH`** ⇒ `/system/health` 503 vĩnh viễn với Redis có mật khẩu. Sửa `redis-health-probe.ts`, test `redis-probe-auth.spec.ts` (đỏ trên code cũ).
2. **`next build` kiểm kiểu cả `test/`** (import `tests/e2e/fake-api`) ⇒ image customer-web không build được. Sửa: `tsconfig.next.json` chỉ gồm mã app; test vẫn typecheck ở CI.
3. **Mẫu `.env` ghi sai về PSP**: production **bắt buộc** khoá VNPay/MoMo (API từ chối mock). Compose giờ báo thiếu ngay; staging chưa có sandbox thì điền chuỗi ngẫu nhiên, khi đó thanh toán online không hoàn tất.
4. **Web không đọc được CA nội bộ của Caddy** (thư mục dữ liệu quyền 700) ⇒ BFF 502 ở staging local. Sửa: chép `root.crt` vào `infra/prod/ca/` (README).

## Chưa làm (ticket sau)

- Backup WAL + full off-site và diễn tập PITR: HB-179.
- Pipeline GHCR + deploy SSH tự quay về bản cũ: HB-177.
- Runbook rollback + diễn tập: HB-180.
- Lượt trên VPS thật với Let's Encrypt: chờ máy + miền.
