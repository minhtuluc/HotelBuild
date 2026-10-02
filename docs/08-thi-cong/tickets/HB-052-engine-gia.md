---
id: HB-052
title: Engine giá thuần (packages/domain/pricing) — US-RATE-01
risk: R2
owner: codex
max_lines: 800
allow:
  - packages/domain/src/pricing/**
  - packages/domain/test/pricing/**
---

# HB-052 — Engine giá

## Mục tiêu

Hàm thuần tính báo giá kỳ lưu trú theo pipeline 11 bước cố định của [động giá](../../02-nghiep-vu/dong-gia.md) §2, cho kết quả từng đêm kèm giải thích, có `engineVersion`. Mọi bề mặt (API + 4 frontend) dùng con số này; lệch 1 VND là lỗi.

## Căn cứ

- [Động giá](../../02-nghiep-vu/dong-gia.md) §2 (11 bước), §4, §5, §8 (ví dụ số)
- BR-RATE-01, BR-RATE-03…10, BR-RATE-17, BR-RATE-18; UC-RATE-05; ADR-015
- TC-RATE-01…12, TC-RATE-22; US-RATE-01 trong [kế hoạch sprint](../../05-ke-hoach/ke-hoach-sprint.md)

## Tiêu chí nghiệm thu

1. Xuất qua `@pinehill/domain/pricing`. Đầu vào: cấu hình đã nạp (giá cơ bản/lịch giá, mùa, hệ số cuối tuần, công suất, LOS, kênh, sàn/trần, khuyến mãi), kỳ lưu trú, kênh, `now`. Không I/O, không đọc đồng hồ, không số thực cho tiền.
2. Pipeline đúng thứ tự §2; phân giải lịch giá, mùa và override kênh–cơ sở theo **ngày của từng đêm**; khi hai mùa chồng nhau chọn theo quy tắc ưu tiên của BR-RATE-05.
3. Làm tròn **lên** ở giá từng đêm và **xuống** ở tổng sau khuyến mãi đúng như §2; giá đêm, subtotal, total và tiền cọc đã chốt là số nguyên VND bội 1.000 (TC-RATE-12, TC-RATE-22). Giá trung gian và mức giảm trước bước 11 giữ chính xác bằng phân số có tử/mẫu nguyên; không làm tròn trung gian và không dùng number số thực cho tiền.
4. Kết quả gồm từng đêm: giá sau mỗi bước dưới dạng phân số chính xác, cờ `clamped` khi chạm sàn/trần, khuyến mãi áp dụng; cộng `engineVersion` (chuỗi hằng, tăng khi đổi công thức).
5. Test: 24 tổ hợp (3 loại phòng × 4 mùa × 2 kênh) khớp bảng tính tay — bảng là dữ liệu trong `test/pricing/fixtures`, ghi nguồn từng con số; mỗi ca TC-RATE-01…12, TC-RATE-22 một test có tên chứa mã TC. TC-RATE-01 kiểm thứ tự dấu vết 11 bước và phản ví dụ đảo kẹp/kênh hoặc AMOUNT/PERCENT (§5 ca 5/6); không yêu cầu đảo hai phép nhân thuần làm đổi giá cuối. Test thuộc tính: giá từng đêm luôn trong [sàn, trần]; tổng không âm.
6. Phủ nhánh ≥ 90%; `pnpm run ci` xanh.

## Ngoài phạm vi

- Quote TTL/fingerprint (HB-074), endpoint báo giá (HB-056), cấu hình giá (HB-054, HB-055).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`

## Ghi chú cho người làm

Chạy song song với HB-032, HB-053 — chỉ sửa thư mục `pricing`. Tài liệu có chỗ mơ hồ về thứ tự hoặc làm tròn thì dừng và báo lead kèm hai cách hiểu, không tự chọn.
