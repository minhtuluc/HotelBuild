---
id: HB-200
title: Ổn định cổng: nâng trần thời gian cho ba ca tích hợp dựng tiến trình/TCP thật
risk: R1
owner: deepseek
max_lines: 300
allow:
  - apps/customer-web/test/**
  - apps/operations-web/test/**
  - apps/worker/test/**
  - apps/customer-web/vitest.config.ts
  - apps/operations-web/vitest.config.ts
  - apps/worker/vitest.config.ts
---

# HB-200 — Nâng trần thời gian cho ba ca tích hợp nặng

> Ticket nhỏ do người thay vai lead cấp. Nguồn: bằng chứng thu được khi chạy cổng các mẻ F3–F4 (xem
> `HB-F6-specs/quotes-cancel-batch-20261016/final-handoff.md` §3c): **ba lượt `pnpm run ci` đỏ oan** vì ca
> `Test timed out in 5000ms`, trong khi cùng commit đó chạy một mình thì xanh.

## Mục tiêu

Ba ca tích hợp **dựng tiến trình thật** (spawn Node / TCP / 65 sự kiện) không còn đỏ ngẫu nhiên khi máy chạy song song
nhiều worktree. Trần mặc định 5 giây của vitest quá sát cho loại ca này, không phải ca sai.

## Ba ca (bằng chứng đỏ thật, đều không liên quan mã đang sửa)

1. `apps/customer-web/test/session/journey-routes.spec.ts` — “actual customer Next journey exports use live HTTP and
   the guest session” (spawn tiến trình Next + HTTP thật) — đỏ khi chạy 3 worktree song song.
2. `apps/operations-web/test/room-block-routes/routes.spec.ts` — “whole room block client → actual BFF → TCP …”
   (chuỗi client → BFF → TCP thật) — đỏ khi chạy chuỗi 3 lượt `ci`.
3. `apps/worker/test/outbox-relay/lease.spec.ts` — “lô đầy sự kiện không-consumer không làm đói sự kiện có consumer”
   (60+5 sự kiện, Redis + PG thật) — cùng điều kiện.

## Tiêu chí nghiệm thu

1. Mỗi ca trong ba ca trên khai **trần thời gian tường minh** (khuyến nghị 30 giây) ở đúng chỗ, kèm **một dòng lý do**
   nêu vì sao (dựng tiến trình/TCP/số sự kiện lớn) — không dựa vào mặc định 5 giây.
2. **Không** hạ/nới/xoá khẳng định, không `skip`, không đổi ngưỡng bao phủ. Chỉ đổi trần thời gian (+ lý do).
3. Bằng chứng: chạy ba ca đó **dưới tải** (ví dụ ba tiến trình vitest chạy song song, hoặc `pnpm run ci` liền nhau
   hai lượt) — dán output thật cho thấy không còn timeout.
4. `pnpm run ci` xanh; `pnpm check:scope` đạt.

## Ranh giới

- **Không** sửa `packages/domain/**` (ca `TC-RATE-22` thuộc nhánh lead `lead/ci-flake-tc-rate-22`, `f3ad3a0`, chưa vào
  `main`) — ghi chú trong PR rằng hai nhánh sẽ phải rebase lẫn nhau, không tự sửa phần của lead.
- Nếu thấy ca nào **đỏ vì lỗi thật** (không phải trần thời gian) thì **dừng và báo** thay vì nâng trần để xanh.
