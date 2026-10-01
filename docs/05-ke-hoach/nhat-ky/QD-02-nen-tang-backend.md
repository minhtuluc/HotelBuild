# QĐ-02 — Quyết định nền tảng backend và chia ticket đợt B0/F1

**Ngày:** 01/10/2026 · **Phạm vi:** phần backend còn thiếu của US-INF-01, US-INF-02, US-SYS-01 và chuẩn bị F1 · **Người lập:** lead (Opus) · **Quy trình:** [08 — thi công đa model](../../08-thi-cong/README.md) · **Ticket:** [backlog](../../08-thi-cong/backlog.md)

Stack lấy nguyên từ [00 §9](../../00-tong-quan.md) và [kiến trúc](../../04-thiet-ke/kien-truc.md): NestJS 11 + Fastify, Prisma 6, PostgreSQL 16 + `btree_gist`, Redis 7 + BullMQ, zod ở biên, Vitest + fast-check, Supertest. QĐ này chỉ chốt các điểm mà tài liệu để ngỏ hoặc mâu thuẫn.

| # | Quyết định | Lý do | Phương án bị loại | Trạng thái |
|---|---|---|---|---|
| 1 | Logger **pino** (mặc định của Fastify), JSON ra stdout, có `correlationId`, che PII theo NFR-SEC-03 | Kiến trúc chỉ yêu cầu "JSON stdout + OTel", không nêu tên thư viện | winston: thêm một lớp không cần thiết trên Fastify | Đã quyết định |
| 2 | Migration baseline **một file** `0001_baseline` sinh bằng `extract:sql` từ csdl §3, rồi đóng băng. Prisma Migrate chỉ dùng để áp và ghi lịch sử; `schema.prisma` sinh bằng `prisma db pull`, CI kiểm không lệch | §3 đã được test như một khối (PGlite + PG16) theo thứ tự FK; tách thành 0001–0007 theo csdl §8.1 phải xếp lại trigger/chỉ mục bằng tay mà không thêm giá trị trước bản phát hành đầu tiên | Viết `schema.prisma` bằng tay rồi `migrate dev`: hai nguồn schema, Prisma không biểu diễn được EXCLUDE/trigger | Đã quyết định; csdl §8.1 sửa theo trong HB-004 |
| 3 | Sau baseline, mọi thay đổi schema là migration tiến mới **và** sửa csdl §3 trong cùng PR; CI so schema dựng từ migration với schema dựng từ §3 | Giữ csdl §3 là nguồn chân lý mà không để migration trôi khỏi tài liệu | Ngừng cập nhật §3 sau baseline: tài liệu chết | Đã quyết định |
| 4 | Migration chạy bằng role chủ (`DATABASE_MIGRATION_URL`), runtime chạy bằng `app_rw` (`DATABASE_URL`) | csdl §3.5 chỉ định role runtime, không có role migration; tách quyền là điều kiện để `REVOKE` trên `audit_logs` có nghĩa | Một role cho cả hai: runtime có quyền DDL/TRUNCATE | Đã quyết định |
| 5 | Baseline có **42 bảng** (đếm `CREATE TABLE` trong §3), không phải "36 bảng" như csdl §8.1 | Số đếm từ tài liệu nguồn; 6 bảng chênh là hạ tầng SYS được thêm sau | — | Đã quyết định; sửa chữ trong HB-001 |
| 6 | Ba tài liệu ghi "45 mã" sửa thành 54 theo api.md §4.2 | Đóng mục *cần xác nhận* số 4 của [QĐ-01](QD-01-nen-tang-f0.md) | — | Đã quyết định; làm trong HB-001 |
| 7 | Preset ESLint purity cho `packages/domain` là `packages/config/eslint/domain.mjs` (ESM), không phải `domain.cjs` | Toàn bộ `packages/config` là ESM | Thêm CJS riêng: hai định dạng trong một gói | Đã quyết định |
| 8 | `frontendRestrictions` chỉ áp cho 4 app giao diện, không áp `apps/api`, `apps/worker` | Hiện glob `apps/**` sẽ cấm `@nestjs`/`@prisma` ngay trong backend | Tắt rule bằng comment trong backend: lách cổng | Đã quyết định; làm trong HB-003 |
| 9 | US-INF-02 ở B0 chứng minh ở **mức CSDL** (200 giao dịch chèn `room_assignments` song song); bản ở mức API `POST /holds` làm lại ở F4 | Chưa có use case giữ chỗ; EXCLUDE là hàng rào cuối theo ADR-014 | Chờ F4 mới chứng minh: Sprint 1 không có bằng chứng chống trùng | Đã quyết định |
| 10 | Máy thư local dùng **Mailpit** thay MailHog trong `docker-compose` | MailHog đã ngừng bảo trì; Mailpit cùng vai trò (SMTP giả + giao diện web) | Giữ MailHog: image cũ không còn vá lỗi | Đã quyết định |

## Đề xuất cho F1 (chốt khi viết đặc tả F1)

| # | Đề xuất | Khoảng trống được lấp |
|---|---|---|
| F1-a | Thêm bảng `auth_sessions` (token hash, family, surface, `last_seen_at` cho idle 15 phút, `expires_at`, `revoked_at`), `guest_credentials` (Argon2id, `failed_login_count`, `locked_until`), `user_pins` (hash PIN, số lần sai, `locked_until`) và `pin_grants` (pinToken dùng một lần, 5 phút, gắn user + mục đích) | api.md §6.3 chỉ mô tả bằng lời; csdl §3 không có bảng phiên/PIN, `guests` không có mật khẩu |
| F1-b | Web giữ refresh token trong cookie HttpOnly/Secure/SameSite=Strict của **chính app Next.js** (route handler đóng vai BFF mỏng gọi `/api/v1/auth/refresh`); access token chỉ ở bộ nhớ. Android dùng `expo-secure-store` | api.md chỉ nói "nếu dùng cookie"; api-client gửi Bearer. Cách này không đổi hợp đồng API |
| F1-c | PIN sai 3 lần liên tiếp thì khoá thao tác tài chính 15 phút — **giả định dùng tạm**, ghi vào sổ câu hỏi mở | Ngưỡng 3 chỉ có ở TC-AUTH-03, không có BR |
| F1-d | Gắn `403 E_AUTH_OUT_OF_SCOPE` vào các endpoint có phạm vi cơ sở trong registry | Mã có trong `errors.ts` nhưng chưa có trên response nào |
