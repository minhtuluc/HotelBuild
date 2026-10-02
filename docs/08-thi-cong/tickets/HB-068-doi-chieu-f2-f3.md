---
id: HB-068
title: Đối chiếu tài liệu ↔ mã F2 + F3; i18n, tiền VND, nhãn giờ VN
risk: R0
owner: gemini
max_lines: 300
allow:
  - docs/07-ban-giao/doi-chieu-f2-f3.md
---

# HB-068 — Đối chiếu tài liệu ↔ mã F2 + F3

## Mục tiêu

Một báo cáo chỉ ra mọi chỗ mã F2/F3 lệch tài liệu (BR/UC/api.md/thiết kế màn hình) và mọi vi phạm i18n/tiền/giờ, để lead giao sửa trước nghiệm thu.

## Căn cứ

- NFR-LOC-01…03; [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §5, §9; api.md §2.2–§2.4, §2.13; QĐ-05
- Phụ thuộc: HB-048, HB-067

## Tiêu chí nghiệm thu

1. Bảng: mỗi endpoint F2/F3 × (vai trò, If-Match, mã lỗi, trường) so với api.md → khớp/lệch kèm file:dòng.
2. Quét chuỗi tiếng Việt cứng ngoài danh mục i18n, tiền dạng số thực, mốc thời gian thiếu nhãn giờ VN trên các màn F2/F3.
3. Không sửa mã; chỉ báo cáo. Lỗi tài liệu (test plan/thiết kế lệch BR) thì đề xuất sửa theo QĐ-05.
