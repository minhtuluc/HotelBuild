---
id: HB-201
title: Nối phiên nhân viên cho các màn ops-web còn gọi client trần
risk: R1
owner: deepseek
max_lines: 900
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
---

# HB-201 — Nối phiên nhân viên cho các màn ops-web còn dùng client trần

> Ticket nhỏ do người thay vai lead cấp. Nguồn: kiểm kê trong mẻ F3–F4 (17/24 màn `app/(ops)/**` gọi
> `opsApiClient(baseUrl)` — client **không gắn phiên** — nên chạy với API thật sẽ 401), và ghi chú cũ của lead
> “các màn F2 cũ dùng opsApiClient chưa gắn phiên, cần kiểm/nối transport khi chạy API thật”.

## Mục tiêu

Mọi màn vận hành gọi API **qua phiên nhân viên** (BFF `/api/session/sys/**` + `createSessionClient`, token trong memory,
refresh bằng cookie như hiện có) — không màn nào còn gọi thẳng API bằng client trần cho lời gọi cần quyền.

## Hiện trạng (bằng chứng, `main` `282d2c0`)

- **Đã đúng (7)**: `app/(ops)/admin-commands/api.ts`, `audit-logs/api.ts`, `bookings/[bookingId]/collect/collect-screen.tsx`,
  `bookings/[bookingId]/refunds/refund-workspace.ts`, `day-board/use-board.ts`, `inventory-grid/api.ts`,
  `system-settings/api.ts` — dùng `createSessionClient` + `baseUrl = window.location.origin + '/api/session/sys'` +
  `getAccessToken`/`onUnauthorized` (mẫu chuẩn: `app/(ops)/audit-logs/api.ts`).
- **Còn client trần (17)**: `bookings/bookings-screen.tsx`, `bookings/[bookingId]/booking-screen.tsx`,
  `bookings/[bookingId]/cancel/cancel-screen.tsx`, `bookings/[bookingId]/reschedule/reschedule-screen.tsx`,
  `bookings/new/new-booking-screen.tsx`, `channels/channels-screen.tsx`, `crm/guests/guests-screen.tsx`,
  `crm/loyalty/loyalty-screen.tsx`, `multi-channel-quote/multi-channel-quote-screen.tsx`,
  `noti/notifications/notifications-screen.tsx`, `promotions/promotions-screen.tsx`, `rate-calendar/rate-calendar-screen.tsx`,
  `reports/cancellations/cancellations-report-screen.tsx`, `reports/occupancy/occupancy-report-screen.tsx`,
  `reports/overbooking/overbooking-report-screen.tsx`, `reports/revenue-by-channel/revenue-channel-screen.tsx`,
  `seasons/seasons-screen.tsx`.
- BFF hiện có **18 tuyến** (`app/api/session/sys/**`): audit-logs, auth/me, cancellation-policies(+[id]), channel-allotments,
  channels, inventory/grid, properties(+[id]), rate-plans(+admin,+[id]), room-blocks(+[id]), rooms(+[id]/connecting-room),
  room-types, system-settings(+[key]). Thiếu cho: bookings(+[id]/cancel/reschedule), holds, crm guests/loyalty,
  rate-calendar, seasons, promotions, quotes(multi-channel), notifications, reports (4 báo cáo + export/operations).

## Tiêu chí nghiệm thu

1. **Không còn** màn nào trong `app/(ops)/**` dùng `opsApiClient` cho lời gọi cần phiên (liệt kê trong PR màn nào đã nối).
2. Thêm **tuyến BFF còn thiếu** theo đúng mẫu đang có (`app/api/session/sys/**/route.ts`): chỉ chuyển tiếp tới API với
   token hiện có, **không** thêm logic nghiệp vụ, **không** đưa token vào cookie/localStorage, giữ nguyên cơ chế refresh.
   Nêu danh sách tuyến đã thêm.
3. **Gom về một nhà máy dùng chung** trong `lib/` (ví dụ `opsSessionClient(module)`) để các màn không tự dựng lại
   `ApiClient` + token; `opsApiClient` chỉ còn dùng cho đường **thật sự công khai** (nếu còn) — nếu không còn chỗ dùng thì xoá.
4. Test: unit hiện có của các màn đã nối **vẫn xanh** (không đổi kỳ vọng); e2e hiện có (chạy app thật + fake API) vẫn xanh;
   thêm ca chứng minh **không gửi request khi chưa có phiên** (401/hết hạn ⇒ trạng thái màn đúng: từ chối/expired) cho ít
   nhất **hai** màn đại diện (một màn danh sách, một màn báo cáo).
5. Báo cáo trong PR: màn đã nối · tuyến BFF đã thêm · phần **chưa** làm được và vì sao.

## Ranh giới

- Không đổi hợp đồng/`packages/**`, không đổi quyền ở máy chủ, không “tiện thể” sửa giao diện/nhãn (mẻ i18n đã đóng).
- Nếu một màn cần API **chưa có** trên `main` (ví dụ báo cáo export), nối đúng phần đã có và ghi rõ phần chờ backend.
