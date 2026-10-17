---
id: HB-202
title: Nâng trần thời gian cho 7 ca cùng kiểu dựng tiến trình trong app web
risk: R0
owner: deepseek
max_lines: 200
allow:
  - apps/customer-web/test/**
  - apps/operations-web/test/**
  - apps/customer-web/vitest.config.ts
  - apps/operations-web/vitest.config.ts
---

# HB-202 — Nâng trần thời gian cho 7 ca cùng kiểu còn lại

> Ticket nhỏ do người thay vai lead cấp, nối tiếp **HB-200** (`ticket/HB-200-tran-thoi-gian-ca-nang`). Nguồn: phát hiện
> ngoài phạm vi của tác giả HB-200 — **cùng cơ chế lệch trần** (ca tự khai 15 giây cho tiến trình con, vitest cắt ở 5 giây)
> nhưng hiện **chưa đỏ** vì ca nhẹ hơn (1,2–2,0 s khi chạy 7 tiến trình song song).

## Bảy ca

`apps/customer-web/test/session/routes.spec.ts` ·
`apps/operations-web/test/session/*.spec.ts` (session, admin-routes, allotment-routes, connecting-routes, grid-routes) ·
`apps/operations-web/test/rate-config*` (đúng đường dẫn do người làm xác nhận lại bằng grep trước khi sửa).

## Tiêu chí nghiệm thu

1. Mỗi ca khai **trần tường minh** phù hợp với trần tiến trình con của chính nó (khuyến nghị bằng hoặc lớn hơn 15 giây; HB-200
   đã dùng 30 giây cho ca nặng) **kèm một dòng lý do**.
2. **Không** hạ/nới/xoá khẳng định, không `skip`, không đổi ngưỡng bao phủ.
3. Bằng chứng: chạy **7 tiến trình song song** (dưới tải) — dán output thật; trước/sau nếu tái hiện được.
4. `pnpm run ci` xanh trên nhánh; `pnpm check:scope` đạt.

## Ranh giới

- **Không** sửa `packages/domain/**` (nhánh lead `lead/ci-flake-tc-rate-22` giữ phần `TC-RATE-22`).
- Ca nào **đỏ vì lỗi thật** ⇒ dừng và báo, không nâng trần để xanh.
- Song song: đề nghị ghi nợ `TD-16` (mẫu “ca tự khai trần tiến trình con ≠ trần vitest”) vào `docs/07-ban-giao/no-ky-thuat.md`
  — việc đó **ngoài `allow`** của ticket này, để người thay vai lead làm.
