---
id: HB-160
title: Hợp đồng F8 — báo cáo, xuất báo cáo, thông báo, CRM quản trị
risk: R2
owner: deepseek
max_lines: 800
allow:
  - packages/contracts/src/**
  - packages/contracts/test/**
  - packages/contracts/openapi.json
  - packages/api-client/src/**
  - packages/api-client/test/**
  - packages/ui-web/src/messages.ts
  - packages/ui-web/src/errors.ts
  - packages/ui-web/test/**
  - docs/04-thiet-ke/api.md
---

# HB-160 — Hợp đồng F8 — báo cáo, xuất báo cáo, thông báo, CRM quản trị

## Mục tiêu

`packages/contracts` đủ endpoint báo cáo/thông báo/CRM để backend HB-162…168 và màn hình SCR-49…55 làm song song. SYS (audit, tham số) đã ở HB-030.

## Căn cứ

- api.md §2.10 CRM (`/guests/{guestId}/anonymize`, `/loyalty`, `/blacklist`), §2.11 NOTI (`/notifications`, `/{notificationId}/resend`), §2.12 REP (`/reports/occupancy`, `/adr-revpar`, `/revenue-by-channel`, `/cancellations`, `/force-majeure`, `/overbooking`, `/export`), §2.14
- UC-REP-01…04, UC-NOTI-01, UC-NOTI-02, UC-CRM-01…03; NFR-MAIN-04
- Phụ thuộc: HB-140

## Tiêu chí nghiệm thu

1. Schema trong `src/report.ts`, `src/notification.ts`, mở rộng `src/guest.ts`; path `src/openapi/paths/f8.ts`.
2. Vai trò theo api.md: báo cáo tài chính (doanh thu, huỷ) ACCOUNTANT/OWNER; `force-majeure` OWNER; `occupancy`, `adr-revpar`, `overbooking` MANAGER+.
3. `/reports/export` trả 202 `{ operationId, status, statusUrl }`; không có `DELETE /guests` (§2.14) — test khẳng định.
4. `check:contract` 0 phá vỡ; client `createReportApi`, `createNotificationApi`, mở rộng `createGuestApi`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
