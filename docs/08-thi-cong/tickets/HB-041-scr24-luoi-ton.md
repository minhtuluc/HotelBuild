---
id: HB-041
title: SCR-24 lưới tồn phòng theo ngày (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 900
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
  - packages/contracts/src/openapi/paths/f2.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/**
  - packages/api-client/src/f2.ts
  - packages/api-client/test/**
  - docs/04-thiet-ke/api.md
  - docs/05-ke-hoach/lo-trinh-thi-cong-web-android.md
locked:
unlock:
---

# HB-041 — SCR-24 lưới tồn phòng theo ngày

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-041 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Lễ tân/quản lý xem được **lưới tồn phòng theo ngày × loại phòng** trong một khoảng tối đa 31 ngày, mỗi ô hiện tồn công bố và trạng thái (còn bán / hết tồn / khoá / quá tải) bằng **ký hiệu chữ kèm màu**, đi được bằng bàn phím; đổi khoảng ngày chỉ tải lại dữ liệu, **không** nạp lại trang. Đây là màn rủi ro cao của F2 (TC-SYS-10, NFR-PERF-05).

## Căn cứ

- Pha: F2 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.4 (`SCR-24`, điều kiện hoàn tất: 55 phòng × 30 ngày, đổi khoảng ngày không tải lại, ≤ 200 KB sau gzip)
- Quy tắc nghiệp vụ: BR-INV-01 (tồn công bố `max(0, pool)`, `pool` nội bộ được âm), BR-INV-07 (hết nếu một đêm hết), NFR-PERF-05, UI-06 (không truyền thông tin chỉ bằng màu)
- Use case / yêu cầu: UC-INV-01; FR-INV-01
- API: `GET /api/v1/inventory/grid` (HOUSEKEEPING) với `propertyId`, `roomTypeId`, `from`, `to`; mã lỗi `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`, `E_GEN_VALIDATION_FAILED`
- Hợp đồng backend: HB-035 (AC1: ô gồm `supply`, `demand`, `pool`, tồn công bố `max(0, pool)`; AC2: 55 × 30 ≤ 200 KB sau gzip)
- Màn hình: `SCR-24`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Lưới hiện đủ hàng (mỗi loại phòng một hàng) và cột (mỗi ngày một cột), ô hiện `ký hiệu + tồn công bố` — test: `inventory-grid.spec.ts::hiện lưới kèm ký hiệu trạng thái và tồn công bố`
2. Ánh xạ trạng thái ô: `pool > 0` → còn bán `·`; `pool = 0` và không khoá → hết tồn `H`; `pool = 0` và có khoá → khoá `B`; `pool < 0` → quá tải `!` (tồn công bố 0) — test: `inventory-grid.spec.ts::hiện lưới…` + `apps/operations-web/test/inventory-grid.spec.ts::trạng thái ô…`
3. `←`/`→`/`↑`/`↓`/`Home`/`End` di chuyển tiêu điểm giữa các ô, không tràn hàng/cột — test: `inventory-grid.spec.ts::điều hướng ô bằng bàn phím`
4. Đổi khoảng ngày rồi bấm "Tải lưới" thì tải lại dữ liệu, **không** nạp lại trang (URL không đổi) — test: `inventory-grid.spec.ts::đổi khoảng ngày chỉ tải lại dữ liệu, không nạp lại trang`
5. Tổng payload của lưới 31 ngày × 3 loại phòng ≤ 200 KB — test: `inventory-grid.spec.ts::tổng payload lưới 31 ngày × 3 loại phòng ≤ 200 KB`
6. Khoảng quá 31 ngày bị chặn tại chỗ (không gọi API) — test: `inventory-grid.spec.ts::khoảng quá 31 ngày thì cảnh báo và không gọi API`
7. `403` khi đọc thì hiện thiếu quyền, không lộ lưới — test: `inventory-grid.spec.ts::403 khi đọc thì hiện thiếu quyền`
8. Không có vi phạm axe serious/critical, không cuộn ngang ở 360 px, và mọi trạng thái §8.1 hiện đúng — test: `inventory-grid.spec.ts::lưới không có vi phạm axe…`, `screens.spec.ts` (thêm `/inventory-grid`)

## Ngoài phạm vi

- Không viết backend HB-035; E2E chạy trên **API giả** (`page.route`) vì HB-033…036 chưa có.
- Không giữ khoá bi quan: `GET /inventory/grid` chỉ đọc (QĐ-02 F2c) — màn hình không xin khoá.
- Không sửa tồn/allotment tại đây (SCR-25, HB-042) và không mở ca quá tải (SCR-23/F4).
- **Chưa làm được lưới theo từng phòng vật lý (55 phòng × 30 ngày)**: hợp đồng `GET /inventory/grid` trả ô theo **loại phòng** (`roomTypeId` trong phản hồi), không có ô theo đơn vị bán. Đề xuất để lead chốt: hoặc backend HB-035 bổ sung tham số trả theo đơn vị bán, hoặc điều kiện "55 phòng × 30 ngày" của lộ trình hiểu là **kiểm hiệu năng phía API** (đúng như AC2 của HB-035) còn giao diện giữ lưới loại phòng × ngày.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- Nhánh này **xếp chồng** trên `ticket/HB-037-scr19-20` (bộ dùng chung + `GET /room-types` chưa merge). `check:scope` chặn `docs/08-thi-cong/**` của nhánh khác nên **đặc tả HB-037 bị bỏ khỏi nhánh này** (bản gốc vẫn ở PR #39); rebase lên `main` sau khi #39 merge sẽ khôi phục. Đó là lý do diff lớn hơn `max_lines` — giải trình ở PR.
- Dùng lại bộ dùng chung của HB-037: `lib/screen-state.ts`, `components/screen-alert.tsx`, `components/forced-state.ts`, `lib/demo-states.ts`; ký hiệu và màu lấy từ token `gridStatus` trong `@pinehill/ui-web` (đã có sẵn `available/held/blocked/oversold`), **không** tự đặt màu mới.
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'` (bẫy `NEXT_PUBLIC_*` nhúng lúc build).
- Số liệu hiển thị suy thẳng từ ô máy chủ trả; **không** áp quy tắc giá/chính sách ở giao diện (AGENTS §2).
