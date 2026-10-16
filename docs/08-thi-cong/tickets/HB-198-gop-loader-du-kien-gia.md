---
id: HB-198
title: Gộp dữ kiện giá về một loader dùng chung cho lịch giá và báo giá
risk: R1
owner: deepseek
max_lines: 400
allow:
  - apps/api/src/modules/rate/calendar/**
  - apps/api/src/modules/rate/pricing-facts/**
  - apps/api/test/rate/**
---

# HB-198 — Gộp dữ kiện giá về một loader dùng chung

> Ticket nhỏ do người thay vai lead cấp (backlog F8–F9 để dành `HB-198`, `HB-199` cho việc tách nhỏ). Nguồn: phân tích
> trong PR #129 (HB-054) và hồ sơ `HB-F6-specs/critical-path-f3f4-batch-20261016/final-handoff.md`.

## Mục tiêu

Hai đường dựng dữ kiện giá cho engine HB-052 hiện trùng nhau: `modules/rate/pricing-facts/loader.ts`
(HB-056, dùng cho `POST /quotes/multi-channel` và sẽ dùng cho `POST /quotes`) và `modules/rate/calendar/facts.ts`
(HB-054, dùng cho `GET /rate-calendar`). Cả hai export **cùng tên** `loadPricingFacts`, trùng **5 mapper dữ liệu**,
hằng số LOS (3/7/14 → 0.95/0.90/0.85), hệ số công suất (1.15/1.25), độ tươi 300.000 ms và cùng khoá `SystemSetting`
(`pricing.weekendMultiplier/occupancyMidPct/occupancyHighPct/maxDiscountPct` → 1.20/80/95/30). Phần **phân giải giá**
không trùng (cả hai đều gọi `quotePrice`), nhưng dữ kiện đầu vào có thể lệch nhau theo thời gian.

Sau ticket này chỉ còn **một** định nghĩa dữ kiện giá.

## Căn cứ

- ADR-015 (một nguồn số), BR-RATE-17 (cùng đầu vào ⇒ cùng giá trên mọi bề mặt), BR-RATE-01 §4.3/§4.4 (hằng số giá)
- `modules/rate/pricing-facts/**` (HB-056), `modules/rate/calendar/**` (HB-054), engine `@pinehill/domain/pricing`
- Hợp đồng `packages/contracts/src/rate.ts` — **không đổi**
- Phụ thuộc: HB-052, HB-054, HB-056 — đều đã có trên `main`

## Tiêu chí nghiệm thu

1. `modules/rate/calendar/facts.ts` **không còn** truy vấn CSDL/mapper riêng: dựng `PricingFacts` bằng
   `loadPricingFacts` của `modules/rate/pricing-facts`, rồi chỉ **thích ứng** phần riêng của lịch giá (thay `ratePlan`
   bằng gói trung tính để loại dòng `RATE_PLAN`; bổ sung `seasonName`/cảnh báo BR-RATE-05/BR-RATE-19 nếu cần).
2. Bỏ phần trùng (khoảng 250 dòng). Nếu adapter cần hằng số/helper dùng chung thì **export thêm** từ `pricing-facts`
   (thay đổi additive), tuyệt đối không chép lại.
3. Hai lệch đã biết tự triệt tiêu vì chỉ còn một truy vấn: lọc `captured_at <= now` và khoảng ngày `date < end`.
   **Không** đổi hành vi truy vấn của loader chuẩn ngoài hai điểm này; nếu buộc phải đổi thì ghi rõ trong PR kèm test.
4. Toàn bộ test hiện có của `apps/api/test/rate/**` (calendar, seasons, override, quotes-multi, channels, policies)
   xanh **không đổi kỳ vọng**; **số ca không giảm**. `GET /rate-calendar` giữ nguyên từng trường của phản hồi.
5. Không sửa `packages/**`, không đổi hợp đồng, không đổi mã lỗi.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Ticket này **không** đổi hành vi quan sát được của `GET /rate-calendar` hay `POST /quotes/multi-channel` — chỉ gộp nguồn.
Nếu phát hiện chỗ nào thật sự phải đổi hành vi, dừng và ghi rõ thay vì tự chốt.
