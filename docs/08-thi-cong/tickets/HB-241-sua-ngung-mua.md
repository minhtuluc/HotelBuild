---
id: HB-241
title: 'Sửa/ngừng mùa — `PUT /seasons/{seasonId}` (TD-06)'
risk: R1
owner: claude
max_lines: 650
allow:
  - packages/contracts/src/rate.ts
  - packages/contracts/src/openapi/paths/f3.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/openapi.spec.ts
  - packages/api-client/src/rate.ts
  - packages/api-client/test/f3-endpoints.spec.ts
  - apps/api/src/modules/rate/seasons/**
  - apps/api/src/modules/rate/rate-plans/support.ts
  - apps/api/test/rate/calendar/season-update.spec.ts
  - apps/api/test/rate/calendar/seasons.spec.ts
  - apps/api/test/rate/calendar/requests.ts
  - apps/api/test/rbac/routes/f3-rate.ts
  - apps/api/test/rbac/registered-routes.spec.ts
  - docs/04-thiet-ke/api.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-241-sua-ngung-mua.md
---

# HB-241 — Sửa/ngừng mùa (TD-06)

> Xếp chồng trên HB-240: cùng sửa `rate.ts`, `f3.ts`, `openapi.json`, `api-client/rate.ts` và oracle RBAC. Merge HB-240 trước.

## Vấn đề

SCR-27 đã liệt kê được mùa (`GET /seasons`), nhưng không sửa được hệ số, `priority` hay khoảng ngày, và không ngừng được một mùa. Mùa nhập sai chỉ sửa được bằng cách đụng thẳng vào CSDL, trong khi mùa tác động trực tiếp lên giá bán.

## Thay đổi

- **Hợp đồng `seasonUpdateRequestSchema`:** các trường đều tùy chọn, `reason` bắt buộc, phải có ít nhất một trường cần sửa. `propertyId` cố định. `seasonSummary` có thêm `status`; trường này optional nên phản hồi cũ vẫn đọc được.
- **`PUT /seasons/{seasonId}`:**
  - Chỉ OWNER; trả 204. Có `Idempotency-Key`, `If-Match` bắt buộc (thiếu thì 428, lệch thì 412).
  - Khoá dòng, kiểm phạm vi cơ sở, gộp thay đổi rồi kiểm lại `seasonIssues` trên bản gộp.
  - Đổi `startDate` thì suy lại mã mùa.
  - Ghi audit kèm danh sách mùa chồng lấn cùng `priority`; phát outbox `RateChanged`.
- **Ngừng mùa = `status: INACTIVE`:** loader giá chỉ đọc mùa `ACTIVE`, nên lịch giá và báo giá mới bỏ qua mùa này. Muốn dùng lại thì bật về `ACTIVE`.
- **`api-client.updateSeason`.**

## Tiêu chí nghiệm thu (`apps/api/test/rate/calendar/season-update.spec.ts`)

1. `HB241_owner_edits_season_and_rate_calendar_uses_new_multiplier`: lịch giá dùng hệ số, tên và khoảng ngày mới; có audit (before/after + lý do) và outbox.
2. `HB241_deactivated_season_no_longer_prices_and_is_listed_inactive`: sau khi ngừng, hệ số mùa trên lịch giá về 1 và danh sách trả `INACTIVE`. Bật lại thì mùa có hiệu lực trở lại.
3. `HB241_merged_rules_and_guards`: `BEFORE_START` trên bản gộp, `SCALE_EXCEEDS_3`, thân rỗng hoặc có `propertyId` bị từ chối 422. Ngoài ra kiểm 428, 412, mùa toàn chuỗi 404, MANAGER 403.
4. Oracle RBAC có `PUT seasons/:seasonId`, chỉ OWNER. `seasons.spec.ts` cập nhật kỳ vọng thêm `status: 'ACTIVE'`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/rate`, `apps/api/test/rbac`.
