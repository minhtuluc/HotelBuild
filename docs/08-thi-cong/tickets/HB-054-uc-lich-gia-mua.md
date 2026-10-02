---
id: HB-054
title: UC + endpoint lịch giá và mùa (rate-calendar, seasons) — xác nhận ±20%, cảnh báo LONGSTAY14
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/api/src/modules/rate/calendar/**
  - apps/api/src/modules/rate/seasons/**
  - apps/api/test/rate/calendar/**
---

# HB-054 — Lịch giá và mùa

## Căn cứ

- api.md §2.4 (`rate-calendar`, `seasons`); FR-RATE-01…06; UC-RATE-01, UC-RATE-02; BR-RATE-02, BR-RATE-03, BR-RATE-05, BR-RATE-06, BR-RATE-19, BR-RBAC-04; TC-RATE-03, TC-RATE-04, TC-AUTH-09
- Hợp đồng `rate.ts` (HB-050); bảng `rate_calendars`, `seasons`; phân giải mùa theo engine HB-052 (`resolution.ts`) — **dùng lại**, không viết logic ưu tiên lần hai
- Phụ thuộc chung: HB-013 (guard xác thực), HB-014 (`@Permission` + `modules/<mod>/permissions.ts`), HB-009 (`AuditWriter`), HB-018 (seed cho test)

## Tiêu chí nghiệm thu

1. `GET rate-calendar`: giá từng ngày kèm `source` (BASE/SEASON/OVERRIDE) và mùa thắng, lấy từ cùng hàm phân giải của engine.
2. `PUT rate-calendar` (OWNER): ghi `source = OVERRIDE`, `priority` cao nhất; giá ngoài [sàn, trần] → `E_RATE_CONFIGURATION_INVALID`; thay đổi > ±20% so với giá hiện hành bắt buộc cờ xác nhận của OWNER trong request, thiếu → 422 (BR-RBAC-04, TC-AUTH-09); cảnh báo LONGSTAY14 không có giá riêng (BR-RATE-19) trả trong `warnings[]`.
3. `POST seasons` (OWNER): khoảng ngày hợp lệ, hệ số trong giới hạn hợp đồng; mùa chồng nhau được phép, test chọn đúng mùa thắng (TC-RATE-03).
4. Audit cùng transaction mọi lệnh ghi. Báo giá đã chốt (snapshot) không bị ảnh hưởng — có test.
5. `pnpm run ci` + `pnpm test:integration` xanh.
