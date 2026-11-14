---
id: HB-315
title: E2E SCR-48 bàn tiền sảnh xanh lại sau #298 (cơ sở đang làm việc + câu phụ thu nhận sớm)
risk: R1
owner: opus
max_lines: 100
allow:
  - tests/e2e/fake-api/f7/**
  - apps/operations-web/src/app/(ops)/front-desk/messages.ts
---

# HB-315 — E2E SCR-48 bàn tiền sảnh xanh lại sau #298

## Mục tiêu

`tests/e2e/ops-front-desk.spec.ts` (HB-152) xanh lại trên main sau PR #298, không đổi spec và không nới assertion.

## Căn cứ

- Ticket gốc: HB-152 (SCR-48), HB-020 (phiên nhân viên, chọn cơ sở); QĐ-03 quyết định 9 (cơ sở đang làm việc)
- API: `GET /api/v1/properties`; mã lỗi `E_AUTH_OUT_OF_SCOPE`
- Màn hình: `SCR-48`

## Nguyên nhân (đo trên 1c6dbae, bản build production + fake API)

8/19 ca đỏ (AC1 ×2, AC2 ×2, AC3, empty, lỗi mạng, 360px), do hai thay đổi trong #298:

1. `front-desk-screen.tsx` truyền `useWorkingProperty()` vào `useFrontDesk`, nên màn mở theo cơ sở của phiên thay vì
   cơ sở đầu tiên của `GET /properties`. Phiên nhân viên đi qua BFF thật tới fake API dùng chung, actor được cấp
   `propertyIds: ['journey-standard']` (`tests/e2e/fake-api/core/auth.ts`), còn fixture F7 trả `/properties` chỉ có
   `p1`. Màn coi cơ sở ngoài danh sách là `E_AUTH_OUT_OF_SCOPE` → trạng thái thiếu quyền, không có dòng
   `desk-arrivals-booking-b1`. Hành vi của màn là đúng (máy chủ cấp phạm vi nào thì `/properties` phải chứa
   cơ sở đó); fixture lệch hợp đồng.
2. `messages.ts` đổi `earlyNote` thành "… do hệ thống tính …", trong khi cùng màn `checkoutNote` vẫn "… do máy chủ
   tính …" và AC1 khẳng định câu "Phụ thu nhận sớm (nếu có) do máy chủ tính".

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Fixture F7 dùng đúng cơ sở mà phiên nhân viên được cấp (`journey-standard`) cho property, room type, phòng,
   booking — test: `tests/e2e/ops-front-desk.spec.ts` (AC1, AC2, AC3, empty, lỗi mạng, 360px)
2. Câu phụ thu nhận sớm thống nhất "do máy chủ tính" với câu phụ thu trả phòng — test:
   `tests/e2e/ops-front-desk.spec.ts::AC1 — check-in thành công hiện phụ thu máy chủ trả và phòng đã gán`
3. Ca 403 và 10 ca trạng thái minh hoạ vẫn xanh.

## Ngoài phạm vi

- Không đổi logic chọn cơ sở của màn hình hay `useWorkingProperty`.
- Không sửa `tests/e2e/ops-front-desk.spec.ts` và `fake-api/core/auth.ts`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Fixture `page.route` của từng phân hệ phải khớp phạm vi mà actor của fake API dùng chung được cấp; màn nào dùng
`useWorkingProperty` (hiện có front-desk, day-board) sẽ gặp đúng lỗi này nếu fixture tự đặt id cơ sở khác.
