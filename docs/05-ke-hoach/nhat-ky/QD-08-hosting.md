# QĐ-08 — Hosting production: một VPS chạy Docker Compose (HB-174)

**Ngày:** 11/11/2026 · **Người lập:** Claude (vai thi công chủ đạo, theo uỷ quyền của chủ dự án ngày 09/11/2026) · **Người quyết:** chủ dự án. Chủ dự án chốt mục 1–2 ngày 11/11/2026; mục 3–7 là **giả định dùng tạm** theo [lộ trình §5](../../08-thi-cong/lo-trinh-den-deploy.md#5-quyết-định-còn-mở), chủ dự án có quyền đổi.

## Phương án đã cân nhắc

| Phương án | Chi phí ước/tháng | RPO/RTO đạt được | Độ phức tạp vận hành |
| --- | --- | --- | --- |
| **A. Một VPS, Docker Compose** (chọn) | ~20–40 USD (4 vCPU / 8 GB / 160 GB) + kho backup ~1–5 USD | RPO ≤ 15 phút (WAL đẩy off-site), RTO ≤ 4 giờ (dựng VPS mới + restore) | Thấp: một máy, một lệnh `docker compose up -d`. Tự lo vá OS và backup |
| B. PaaS container (Fly/Render/Railway) + managed PostgreSQL | ~60–150 USD | RPO/RTO do nhà cung cấp | Trung bình: nhiều dịch vụ; không cần quản OS |
| C. VPS + managed PostgreSQL | ~50–90 USD | RPO ≤ 5 phút (PITR managed) | Trung bình: hai nhà cung cấp, mạng riêng/allowlist |

## Quyết định

| # | Chủ đề | Quyết định | Trạng thái |
| --- | --- | --- | --- |
| 1 | Hình thái | **Một VPS chạy `docker compose`**. Mỗi tiến trình một container (api, worker, customer-web, operations-web, postgres, redis, reverse proxy); deploy bằng một lệnh | Chủ dự án chốt |
| 2 | Web | `customer-web` và `operations-web` **chạy trên cùng VPS** (Next.js standalone sau reverse proxy), **không** dùng Vercel. Kiến trúc §7 cập nhật theo | Chủ dự án chốt |
| 3 | CSDL/cache | PostgreSQL 16 và Redis 7 là container trên cùng VPS, có volume. Chỉ mạng nội bộ compose, không mở cổng ra Internet | Giả định dùng tạm |
| 4 | Reverse proxy + TLS | **Caddy 2**: tự cấp và gia hạn chứng chỉ Let's Encrypt, HSTS, HTTP→HTTPS. Chỉ mở 80/443 (+ SSH) | Giả định dùng tạm |
| 5 | Tên miền | Ba host khai qua biến: `CUSTOMER_HOST`, `OPS_HOST`, `API_HOST` (ví dụ `book.`, `ops.`, `api.<miền>`). Chưa có miền thì dựng staging bằng `*.localhost` + TLS nội bộ của Caddy | Chờ chủ dự án cấp miền |
| 6 | Backup off-site | Kho object **S3-compatible** (Backblaze B2 / Cloudflare R2 / S3) khai qua biến; dữ liệu mã hoá trước khi đẩy; **chủ dự án giữ khoá truy cập và khoá mã hoá**, VPS chỉ giữ khoá ghi. Thi công ở HB-179 | Giả định dùng tạm |
| 7 | Phát hành | GitHub Actions build image gắn SHA lên GHCR. VPS `docker compose pull && up -d` (thủ công hoặc SSH từ Actions, HB-177) | Giả định dùng tạm |
| 8 | Nhà cung cấp/vùng | Chưa chọn. Yêu cầu tối thiểu 4 vCPU / 8 GB RAM / SSD 160 GB. k6 HB-184 cho thấy một tiến trình API khoảng 180 rps với hỗn hợp tải chuẩn. Vùng gần Việt Nam (VN hoặc Singapore) | Chờ chủ dự án |

## Hệ quả

- **HB-175** dựng `infra/prod/` (compose + Caddyfile + Dockerfile web), thay phần "Vercel" của kiến trúc §7.
- **HB-179** (backup PITR off-site), **HB-177** (pipeline), **HB-180** (rollback) bám QĐ này.
- **TD-71** (`trustProxy`): API đứng sau Caddy nên phải tin đúng một hop proxy nội bộ. Làm cùng HB-175, theo quyết định ở `van-hanh/bao-mat-ci.md`.
- Hạn mức tra tồn công khai theo IP (HB-075) đúng IP khách chỉ khi `trustProxy` bật đúng.
