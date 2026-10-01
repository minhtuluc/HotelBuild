# AGENTS.md — luật chung cho mọi agent trong repo HotelBuild

Áp dụng cho DeepSeek (oh-my-pi), Gemini (Antigravity), GPT-6.1 Sol (Codex) và Claude Opus (Kiro). Quy trình đầy đủ: [docs/08-thi-cong/README.md](docs/08-thi-cong/README.md).

## 1. Trước khi làm

1. Xác định ticket `HB-nnn` của mình trong `docs/08-thi-cong/tickets/`. Không có ticket thì không sửa code — hỏi lead.
2. Làm trên nhánh `ticket/HB-nnn-<slug>` trong worktree riêng **ngoài** `src/` (vd. `../wt/HB-nnn`). Không làm thẳng trên `main`.
3. Đọc đúng các nguồn mà ticket trỏ tới (BR/UC/API/màn hình). Nguồn chân lý nghiệp vụ là `docs/02-nghiep-vu/quy-tac-nghiep-vu.md`; khi tài liệu mâu thuẫn, dừng lại và báo lead, không tự chọn.

## 2. Ranh giới cứng

- Chỉ sửa file khớp `allow` của ticket. `pnpm check:scope` chặn mọi file ngoài phạm vi.
- **Không** sửa file trong `locked` (test khoá do người duyệt viết) và file được bảo vệ (`scripts/lib/scope.mjs` → `PROTECTED`): tài liệu thiết kế 00–04, ticket, `openapi.baseline.json`, `packages/config`, CI, `package.json`, công cụ QC, file này.
- Không làm test xanh bằng cách nới assertion, `skip`, `only`, bắt-rồi-nuốt lỗi hoặc mock chính thứ đang kiểm.
- Không đưa luật giá, policy, phân quyền hay trạng thái nghiệp vụ vào frontend (ADR-018, `pnpm check:imports`).
- Tiền là VND số nguyên; thời gian và ID truyền qua tham số trong `packages/domain`.
- Không commit bí mật, dữ liệu khách thật, `.env`. Không push lên remote `nen-ooad` (repo nền chỉ để tham chiếu).
- Không merge, không force-push, không sửa lịch sử `main`.
- Không tạo nhánh `lead/*` và không sửa file trong `docs/08-thi-cong/`. Ticket thiếu `allow`/`unlock` hoặc sai đặc tả: dừng, ghi rõ file + dòng + diff đề xuất vào PR, chờ lead sửa ticket.

## 3. Định nghĩa "xong"

Một ticket chỉ xong khi các lệnh dưới đây chạy **thật** và xanh trên đúng commit, kèm log trong mô tả PR:

```sh
pnpm check:scope
pnpm run ci        # contract, imports, typecheck, lint, format, coverage, build
npm run check      # tài liệu + tooling + DB (khi ticket đụng docs/scripts/DDL)
```

Lời tự báo "đã xong/đã test" không phải bằng chứng. Không chạy được cổng nào thì ghi `BLOCKED` + lý do, không ghi đạt.

## 4. Báo cáo khi dừng

Mô tả PR (hoặc tin nhắn cuối phiên) gồm: ticket, file đã sửa, lệnh đã chạy + kết quả, phần chưa làm/`BLOCKED`, câu hỏi cho lead. Cùng một lỗi thất bại hai vòng → dừng và chuyển cấp (xem quy trình §5), không thử vòng thứ ba.
