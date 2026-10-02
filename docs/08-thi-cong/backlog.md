# Backlog thi công

**Toàn bộ đường tới deploy:** [lộ trình đến deploy](lo-trinh-den-deploy.md) · [sổ tay lead](so-tay-lead.md) · backlog [F2–F3](backlog-f2-f3.md) · [F4–F5](backlog-f4-f5.md) · [F6–F7](backlog-f6-f7.md) · [F8–F9](backlog-f8-f9.md). Trang này giữ B0 và F1.

Thứ tự và phân công. Chỉ ticket có file trong [tickets/](tickets/) mới được giao; các dòng "chưa đặc tả" sẽ được lead viết đặc tả khi các ticket mà nó phụ thuộc đã merge, để đặc tả bám mã thật. Quyết định nền: [QĐ-02](../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md).

## Đợt B0 — nền backend (US-INF-01 phần còn lại, US-INF-02, US-SYS-01)

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Trạng thái |
|---|---|---|---|---|---|
| [HB-001](tickets/HB-001-dong-bo-tai-lieu.md) | Đồng bộ tài liệu: 54 mã lỗi, preset `domain.mjs`, thứ tự khoá theo ADR-014 | R0 | DeepSeek | — | Xong (#3) |
| [HB-002](tickets/HB-002-docker-compose.md) | `infra/docker-compose.yml` (PostgreSQL 16, Redis 7, Mailpit) + `.env.example` | R1 | DeepSeek | — | Xong (#7) |
| [HB-003](tickets/HB-003-packages-domain.md) | `packages/domain` + preset ESLint purity + test 0 I/O; tách luật frontend khỏi backend | R2 | Codex | — | Xong (#5) |
| [HB-004](tickets/HB-004-api-skeleton.md) | Khung `apps/api` NestJS + Fastify: config, log, lỗi, `GET /system/health` | R1 | DeepSeek | HB-003 | Xong (#8) |
| [HB-005](tickets/HB-005-migration-baseline.md) | Migration baseline từ csdl §3 + `pnpm migrate` + kiểm schema | R2 | Codex | HB-002, HB-004 | Xong (#15) |
| [HB-006](tickets/HB-006-worker-skeleton.md) | Khung `apps/worker` BullMQ + Dockerfile api/worker | R1 | DeepSeek | HB-004 | Xong (#12) |
| [HB-007](tickets/HB-007-ci-backend.md) | Job CI backend: PG16 + Redis, migrate trên CSDL trống, test tích hợp | R2 | Codex | HB-005 | Chờ |
| [HB-008](tickets/HB-008-chong-trung-phong.md) | US-INF-02: 200 giao dịch song song, đúng 1 thắng | R2 | Codex | HB-007 | Chờ |
| [HB-009](tickets/HB-009-audit-writer.md) | US-SYS-01: ghi nhật ký kiểm toán trong cùng transaction | R2 | Codex (test khoá) → DeepSeek | HB-007 | Chờ |

Song song ngay: HB-001, HB-002, HB-003 (phạm vi `allow` không chồng nhau). Gemini review cấp 1 mọi PR; QA trình duyệt chưa cần ở B0.

## Đợt F1 — định danh, phiên, phân quyền

Quyết định: [QĐ-03](../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) (người dùng chốt 02/10/2026). Theo [lộ trình §7.3](../05-ke-hoach/lo-trinh-thi-cong-web-android.md#73-f1--định-danh-phiên-và-phân-quyền). Frontend làm song song với backend trên hợp đồng HB-011 + API giả.

| Ticket | Việc | Hạng | Làm | Phụ thuộc |
|---|---|---|---|---|
| [HB-011](tickets/HB-011-hop-dong-f1.md) | Hợp đồng F1: 7 endpoint, 7 mã lỗi, client, thông điệp UI — **xong (#19)** | R2 | DeepSeek | — |
| [HB-012](tickets/HB-012-hop-dong-bo-sung-f1.md) | Bổ sung hợp đồng: `GET /auth/me`, `clientSurface` khi khách đăng ký, `retryAfterSeconds` + tự refresh trong api-client; nối vào 2 app Android | R2 | DeepSeek | HB-022 |
| [HB-027](tickets/HB-027-goi-chung-runtime.md) | Gói dùng chung nạp được ở runtime Node (image) — **xong (#18)** | R1 | DeepSeek | — |
| [HB-010](tickets/HB-010-bang-phien-credential.md) | Bảng phiên/credential/PIN/reset: csdl §3 + migration 0002 | R2 | Codex | HB-005 |
| [HB-018](tickets/HB-018-seed-bootstrap.md) | Seed tham chiếu + 7 tài khoản dev + `owner:bootstrap` | R1 | DeepSeek | HB-010 |
| [HB-013](tickets/HB-013-auth-loi.md) | Auth lõi nhân viên: login/refresh/logout/đổi mật khẩu, khoá, rate limit, idle | R2 | Codex (test khoá) → DeepSeek | HB-007, HB-009, HB-010, HB-011, HB-027 |
| [HB-014](tickets/HB-014-rbac.md) | RBAC: ma trận quyền, phạm vi cơ sở, deny mặc định | R2 | Codex | HB-013 |
| [HB-015](tickets/HB-015-pin.md) | PIN + `pinToken` dùng một lần | R2 | Codex (test khoá) → DeepSeek | HB-014 |
| [HB-016](tickets/HB-016-quan-ly-nguoi-dung.md) | `GET/POST /users`, `PUT access`, thu hồi phiên | R2 | Codex (test khoá) → DeepSeek | HB-014 |
| [HB-017](tickets/HB-017-guest-auth.md) | Guest auth | R2 | Codex (test khoá) → DeepSeek | HB-014 |
| [HB-028](tickets/HB-028-quen-mat-khau-email.md) | Khách quên mật khẩu qua email | R2 | Codex (test khoá) → DeepSeek | HB-017 |
| [HB-019](tickets/HB-019-bff-phien-web.md) | BFF cookie cho 2 web app + API giả dùng chung cho E2E | R2 | Codex | HB-011 |
| [HB-020](tickets/HB-020-scr14-dang-nhap-ops-web.md) | SCR-14 đăng nhập + chọn cơ sở (operations web) | R1 | DeepSeek | HB-019 |
| [HB-021](tickets/HB-021-scr15-nguoi-dung.md) | SCR-15 người dùng/vai trò/phạm vi | R1 | DeepSeek | HB-020 |
| [HB-022](tickets/HB-022-scr56-android-ops.md) | SCR-56 đăng nhập + PIN (operations Android) | R1 | DeepSeek | HB-011 |
| [HB-023](tickets/HB-023-scr08-khach-web.md) | SCR-08 khách web + quên mật khẩu | R1 | DeepSeek | HB-019 |
| [HB-024](tickets/HB-024-scr71-khach-android.md) | SCR-71 khách Android — **xong (#23)** | R1 | DeepSeek | HB-011 |
| [HB-025](tickets/HB-025-qa-f1.md) | QA F1 trên API thật, Chromium + WebKit, Maestro | R0 | Gemini | tất cả ở trên |
| HB-026 | Nghiệm thu F1 | — | Opus | HB-025 |

Mã HB-012 trước định dành cho test khoá gộp; nay dùng cho bổ sung hợp đồng (mỗi ticket R2 tự có giai đoạn A viết test khoá). Codex là nút thắt (B0 + F1 có 12 việc); nếu Codex chậm, Opus nhận giai đoạn A của HB-013/HB-015/HB-016/HB-017.

## Nợ F0 còn mở

| Việc | Làm | Ghi chú |
|---|---|---|
| Chạy `e2e-nightly` WebKit lấy log (NFR-USE-04) | Gemini → lead | **Xong 02/10**: Gemini phát hiện config thiếu project WebKit; PR #14 sửa, run 36902488210 xanh 72/72 |
| Smoke Android trên emulator/thiết bị | Người dùng | Emulator máy hiện tại crash (xem review-f0-response) |
| Log CI từ xa trên commit F0 | — | Đã có: CI xanh trên `e7f90f0` ở repo HotelBuild |
