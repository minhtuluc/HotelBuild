---
id: HB-035
title: UC + endpoint lưới tồn và allotment theo kênh
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/api/src/modules/inv/grid/**
  - apps/api/src/modules/inv/allotments/**
  - apps/api/test/inventory/**
---

# HB-035 — Lưới tồn và allotment

## Mục tiêu

`GET /inventory/grid` trả tồn từng (loại phòng, ngày) bằng engine HB-032 trên dữ liệu thật; `GET/PUT /channel-allotments` đọc và đặt lại allotment theo lô trong một transaction.

## Căn cứ

- api.md §2.3; FR-INV-01, FR-INV-06; UC-INV-01, UC-INV-03; BR-INV-01, BR-INV-05, BR-INV-07; NFR-PERF-05; QĐ-05 mục 2–3
- Loader dữ kiện tồn `modules/inv/facts` (HB-034) — dùng lại, không viết lại; hợp đồng `inventory.ts` (HB-030)
- Phụ thuộc chung: HB-013 (guard xác thực), HB-014 (`@Permission` + `modules/<mod>/permissions.ts`), HB-009 (`AuditWriter`), HB-018 (seed cho test); HB-034

## Tiêu chí nghiệm thu

1. Grid: ô gồm `supply`, `demand`, `pool` (được âm), tồn công bố `max(0, pool)`, tồn kênh nếu có `channelCode`; tối đa 31 ngày (đã chặn ở schema); chỉ đọc, **không** giữ khoá (QĐ-02 F2c).
2. Hiệu năng: 55 phòng × 30 ngày trả trong ≤ 800 ms p95 trên seed cục bộ (đo bằng test có in thời gian); payload gzip ≤ 200 KB.
3. Allotment PUT: một transaction cho cả lô; mỗi kênh/ngày `allotment ≤` số đơn vị bán ACTIVE (BR-INV-05), **không** ràng buộc tổng các kênh (QĐ-05); vượt → 409 kèm danh sách ngày vi phạm; If-Match; audit.
4. Quyền: grid HOUSEKEEPING+ theo phạm vi; allotment MANAGER+.
5. Test PG16 trên seed + dữ liệu booking giả: số grid khớp tính tay ở 3 ngày mẫu (có block, hold còn hạn, hold hết hạn).
6. `pnpm run ci` + `pnpm test:integration` xanh.
