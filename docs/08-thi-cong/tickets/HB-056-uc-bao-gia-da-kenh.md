---
id: HB-056
title: UC + endpoint báo giá đa kênh (quotes/multi-channel)
risk: R1
owner: deepseek
max_lines: 450
allow:
  - apps/api/src/modules/rate/quotes-multi/**
  - apps/api/src/modules/rate/pricing-facts/**
  - apps/api/test/rate/quotes-multi/**
---

# HB-056 — Báo giá đa kênh

## Căn cứ

- api.md §2.4 (`POST /quotes/multi-channel`); FR-RATE-17; UC-RATE-05; BR-RATE-07, BR-RATE-08, BR-RATE-09, BR-RATE-17; TC-RATE-21
- Engine giá `@pinehill/domain/pricing` (HB-052); hợp đồng HB-050
- Phụ thuộc chung: HB-013 (guard xác thực), HB-014 (`@Permission` + `modules/<mod>/permissions.ts`), HB-009 (`AuditWriter`), HB-018 (seed cho test); HB-054, HB-055

## Tiêu chí nghiệm thu

1. **Loader dữ kiện giá** `modules/rate/pricing-facts`: dựng đầu vào engine HB-052 từ CSDL (lịch giá, mùa, kênh + override theo cơ sở, công suất, khuyến mãi). Dùng chung cho `POST /quotes` ở F4 (HB-074).
2. Endpoint chạy engine cho từng kênh yêu cầu (mặc định cả 7) cùng một đầu vào; trả gộp/thuần/hoa hồng và cảnh báo OTA < WEB.
3. Kết quả **khớp từng VND** với gọi engine trực tiếp trên cùng dữ kiện, và với ca 2 động giá §5 trên seed (8.112.000 cho OTA_BOOKING).
4. Chỉ đọc; không tạo quote/snapshot. MANAGER+.
5. `pnpm run ci` + `pnpm test:integration` xanh.
