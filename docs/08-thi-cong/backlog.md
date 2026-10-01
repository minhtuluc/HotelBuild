# Backlog thi công

Thứ tự và phân công. Chỉ ticket có file trong [tickets/](tickets/) mới được giao; các dòng "chưa đặc tả" sẽ được lead viết đặc tả khi các ticket mà nó phụ thuộc đã merge, để đặc tả bám mã thật. Quyết định nền: [QĐ-02](../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md).

## Đợt B0 — nền backend (US-INF-01 phần còn lại, US-INF-02, US-SYS-01)

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Trạng thái |
|---|---|---|---|---|---|
| [HB-001](tickets/HB-001-dong-bo-tai-lieu.md) | Đồng bộ tài liệu: 54 mã lỗi, preset `domain.mjs`, thứ tự khoá theo ADR-014 | R0 | DeepSeek | — | Sẵn sàng |
| [HB-002](tickets/HB-002-docker-compose.md) | `infra/docker-compose.yml` (PostgreSQL 16, Redis 7, Mailpit) + `.env.example` | R1 | DeepSeek | — | Sẵn sàng |
| [HB-003](tickets/HB-003-packages-domain.md) | `packages/domain` + preset ESLint purity + test 0 I/O; tách luật frontend khỏi backend | R2 | Codex | — | Sẵn sàng |
| [HB-004](tickets/HB-004-api-skeleton.md) | Khung `apps/api` NestJS + Fastify: config, log, lỗi, `GET /system/health` | R1 | DeepSeek | HB-003 | Chờ HB-003 |
| [HB-005](tickets/HB-005-migration-baseline.md) | Migration baseline từ csdl §3 + `pnpm migrate` + kiểm schema | R2 | Codex | HB-002, HB-004 | Chờ |
| [HB-006](tickets/HB-006-worker-skeleton.md) | Khung `apps/worker` BullMQ + Dockerfile api/worker | R1 | DeepSeek | HB-004 | Chờ HB-004 |
| [HB-007](tickets/HB-007-ci-backend.md) | Job CI backend: PG16 + Redis, migrate trên CSDL trống, test tích hợp | R2 | Codex | HB-005 | Chờ |
| [HB-008](tickets/HB-008-chong-trung-phong.md) | US-INF-02: 200 giao dịch song song, đúng 1 thắng | R2 | Codex | HB-007 | Chờ |
| [HB-009](tickets/HB-009-audit-writer.md) | US-SYS-01: ghi nhật ký kiểm toán trong cùng transaction | R2 | Codex (test khoá) → DeepSeek | HB-007 | Chờ |

Song song ngay: HB-001, HB-002, HB-003 (phạm vi `allow` không chồng nhau). Gemini review cấp 1 mọi PR; QA trình duyệt chưa cần ở B0.

## Đợt F1 — định danh, phiên, phân quyền (chưa đặc tả)

Theo [lộ trình §7.3](../05-ke-hoach/lo-trinh-thi-cong-web-android.md#73-f1--định-danh-phiên-và-phân-quyền). Backend trước, giao diện sau.

| Ticket | Việc | Hạng | Làm |
|---|---|---|---|
| HB-010 | Bảng phiên/credential (QĐ-02 F1-a): csdl §3 + migration + test DB | R2 | Codex |
| HB-011 | Hợp đồng: `403 E_AUTH_OUT_OF_SCOPE` trên endpoint có phạm vi (F1-d) | R1 | DeepSeek |
| HB-012 | Test khoá auth lõi: TC-AUTH-01, TC-AUTH-02, TC-AUTH-04…08 | R2 | Codex |
| HB-013 | Auth lõi: login/refresh/logout, Argon2id, khoá 5 lần/15 phút, rate limit, idle 15 phút | R2 | DeepSeek |
| HB-014 | RBAC: `ActorContext`, guard xác thực → vai trò → phạm vi → trạng thái, ma trận quyền | R2 | Codex |
| HB-015 | PIN + `pinToken` dùng một lần (TC-AUTH-03, giả định F1-c) | R2 | Codex (test) → DeepSeek |
| HB-016 | `PUT /users/{id}/access`: If-Match, chống tự nâng quyền, thu hồi phiên, audit | R2 | Codex (test) → DeepSeek |
| HB-017 | Guest auth: đăng ký/đăng nhập theo SĐT chuẩn hoá, consent | R2 | Codex (test) → DeepSeek |
| HB-018 | Seed dữ liệu tham chiếu (csdl §8.1 mục 0008) + 7 tài khoản giả | R1 | DeepSeek |
| HB-019 | BFF cookie cho 2 web app (QĐ-02 F1-b) | R2 | Codex |
| HB-020 | SCR-14 đăng nhập nội bộ + chọn cơ sở (operations web) | R1 | DeepSeek |
| HB-021 | SCR-15 người dùng/vai trò/phạm vi (operations web) | R1 | DeepSeek |
| HB-022 | SCR-56 đăng nhập + PIN + secure storage (operations Android) | R1 | DeepSeek |
| HB-023 | SCR-08 đăng ký/đăng nhập khách (customer web) | R1 | DeepSeek |
| HB-024 | SCR-71 đăng ký/đăng nhập khách (customer Android) | R1 | DeepSeek |
| HB-025 | QA F1 trên trình duyệt (Chromium + WebKit, axe) + kịch bản Maestro | R0 | Gemini |
| HB-026 | Nghiệm thu F1, cập nhật bằng chứng | — | Opus |

## Nợ F0 còn mở

| Việc | Làm | Ghi chú |
|---|---|---|
| Chạy `e2e-nightly` WebKit lấy log (NFR-USE-04) | Gemini | Có thể chạy tay qua `workflow_dispatch` |
| Smoke Android trên emulator/thiết bị | Người dùng | Emulator máy hiện tại crash (xem review-f0-response) |
| Log CI từ xa trên commit F0 | — | Đã có: CI xanh trên `e7f90f0` ở repo HotelBuild |
