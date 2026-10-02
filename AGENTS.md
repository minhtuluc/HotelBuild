# AGENTS.md — luật chung cho mọi agent trong repo HotelBuild

Áp dụng cho Codex (GPT-6.1 Sol), DeepSeek (oh-my-pi), Gemini (Antigravity). Quy trình: [docs/08-thi-cong/README.md](docs/08-thi-cong/README.md) · quyết định quản trị: [QĐ-04](docs/05-ke-hoach/nhat-ky/QD-04-quan-tri-tu-chu.md). Đầu mối báo cáo **duy nhất** là lead (Opus).

## 1. Nhận việc

1. Ticket `HB-nnn` có đặc tả trong `docs/08-thi-cong/tickets/` thì làm theo đặc tả. Chưa có đặc tả mà có dòng trong `docs/08-thi-cong/backlog*.md` và đúng trình độ của mình (bảng §5) → **tự soạn** `docs/08-thi-cong/tickets/HB-nnn-<slug>.md` theo `tickets/_mau.md` làm commit đầu tiên của nhánh, rồi làm tiếp. Không chờ lead.
2. Làm trên nhánh `ticket/HB-nnn-<slug>` trong worktree riêng ngoài `src/` (vd. `../wt/HB-nnn`).
3. Đọc đúng nguồn ghi trong ticket. Nguồn chân lý nghiệp vụ là `docs/02-nghiep-vu/quy-tac-nghiep-vu.md`.

## 2. Hàng rào cứng (vi phạm thì PR bị trả)

- Không sửa test khoá (`locked`) của ticket, không sửa file bảo vệ (`PROTECTED` trong `scripts/lib/scope.mjs`) — `check:scope` chặn. Không sửa đặc tả ticket đã có trên `main` (kể cả của mình).
- Không làm test xanh bằng cách nới assertion, `skip`, `only`, bắt-rồi-nuốt lỗi hoặc mock chính thứ đang kiểm.
- Không phá vỡ hợp đồng API đã phát hành (`pnpm check:contract` phải 0 phá vỡ).
- Không đưa luật giá, policy, phân quyền hay trạng thái nghiệp vụ vào frontend. Tiền là VND số nguyên; thời gian/ID qua tham số trong `packages/domain`.
- Không commit bí mật, dữ liệu khách thật, `.env`; không ghi PII/token/mật khẩu vào log.
- Không merge, không force-push `main`, không push lên remote `nen-ooad`.

## 3. Định nghĩa "xong" — tự kiểm trước khi nộp

Nộp PR chỉ khi **tất cả** đạt trên đúng commit nộp:

1. `pnpm run ci` xanh và `pnpm check:scope` không có lỗi (cảnh báo thì giải trình ở PR).
2. Đụng docs/scripts/DDL thì `npm run check` xanh.
3. **Chạy thật** đúng loại việc, không chỉ chạy test: backend → `pnpm infra:up` + migrate + gọi endpoint; image → `docker build` + `docker run`; web → `pnpm test:e2e` và mở màn hình; Android → bundle Hermes (smoke thiết bị ghi `BLOCKED` nếu không có máy).
4. Tự đọc lại diff theo danh sách: bí mật/PII, `new Date()`/`Math.random()` trong miền, quyền thiếu ở endpoint, lỗi bị nuốt, test bị nới.
5. CI của PR trên GitHub xanh.

Lời tự báo "đã xong" không thay được bằng chứng; không chạy được bước nào thì ghi `BLOCKED` + lý do.

## 4. Tự quyết hay leo thang

**Tự quyết, ghi vào mục "Quyết định tự đưa ra" của PR, làm tiếp:** đặt tên/cấu trúc file; sửa nhỏ file ngoài `allow` mà ticket cần (helper, client, README, tài liệu thiết kế 03–04 cho khớp mã); vượt `max_lines` với lý do; **thêm** trường/endpoint không phá vỡ vào hợp đồng khi ticket cần; thứ chưa kịp làm và không chạm tiền/tồn/bảo mật → ghi vào `docs/07-ban-giao/no-ky-thuat.md`. Kế hoạch kiểm thử (`docs/05`) hoặc thiết kế 03–04 mâu thuẫn quy tắc nghiệp vụ (`docs/02`) → làm theo quy tắc nghiệp vụ, sửa tài liệu kia trong cùng PR (QĐ-05).

**Dừng và báo lead (một tin, có đề xuất):** đổi quy tắc nghiệp vụ hoặc yêu cầu (`docs/01`, `docs/02`); thay đổi phá vỡ hợp đồng; đổi ngữ nghĩa tiền, tồn, phân quyền, bảo mật; cần sửa file bảo vệ; hai **quy tắc nghiệp vụ** mâu thuẫn nhau; việc lấn sang phạm vi ticket khác đang làm.

## 5. Ai làm gì

| Trình độ | Agent | Nhận |
|---|---|---|
| 1 | Codex (GPT-6.1 Sol) | Mọi R2 lõi: engine miền, khoá/đồng thời, tiền (ledger, PSP, hoàn, chi), auth/RBAC/phiên/PIN, migration, idempotency/inbox/outbox/worker, BFF, CI/hạ tầng/deploy/bảo mật/tải. Tự viết test của mình. Được tách phần ít rủi ro cho DeepSeek bằng test khoá nếu muốn |
| 2 | DeepSeek | R1: hợp đồng (thêm mới), use case CRUD không có tiền/đồng thời, màn hình 4 frontend, seed, script, Docker; phần B của R2 khi Codex giao kèm test khoá |
| 3 | Gemini | R0: tài liệu, i18n, accessibility, kịch bản E2E/Maestro, chạy QA và ghi bằng chứng, dữ liệu kiểm thử; review khi được nhờ |

Gặp việc vượt trình độ của mình thì báo lead để chuyển, không cố làm.

## 6. Nộp bài

Mở PR (mẫu `.github/pull_request_template.md`), điền đủ: ticket, đã chạy gì và kết quả, ngoài phạm vi đã sửa, quyết định tự đưa ra, nợ kỹ thuật đã ghi, `BLOCKED`. Báo lead một lần khi PR sẵn sàng; không chờ agent khác review.
