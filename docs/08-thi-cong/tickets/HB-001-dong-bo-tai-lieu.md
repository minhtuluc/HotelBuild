---
id: HB-001
title: Đồng bộ tài liệu theo QĐ-02 (54 mã lỗi, preset domain.mjs, thứ tự khoá)
risk: R0
owner: deepseek
max_lines: 120
allow:
  - docs/05-ke-hoach/quy-tac-ky-thuat.md
  - docs/05-ke-hoach/quan-ly-rui-ro.md
  - docs/05-ke-hoach/lo-trinh-thi-cong-web-android.md
unlock:
  - docs/00-tong-quan.md
  - docs/01-yeu-cau/yeu-cau-phi-chuc-nang.md
  - docs/02-nghiep-vu/dong-gia.md
  - docs/04-thiet-ke/kien-truc.md
---

# HB-001 — Đồng bộ tài liệu theo QĐ-02

## Mục tiêu

Tài liệu không còn tự mâu thuẫn ở ba điểm đã được [QĐ-02](../../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md) chốt. Chỉ sửa chữ, không đổi nghĩa nghiệp vụ.

## Căn cứ

- QĐ-02 mục 6 (54 mã), mục 7 (`domain.mjs`); [QĐ-01](../../05-ke-hoach/nhat-ky/QD-01-nen-tang-f0.md) mục 4
- Bảng mã lỗi nguồn: `docs/04-thiet-ke/api.md` §4.2 (54 dòng) — **không sửa file này**
- [ADR-014](../../04-thiet-ke/adr/ADR-014-giao-dich-ton-phong.md) — thứ tự khoá chuẩn

## Tiêu chí nghiệm thu

1. `git grep -n "45 mã" -- docs` chỉ còn các dòng trong `docs/05-ke-hoach/nhat-ky/` (hồ sơ lịch sử). Mọi chỗ khác ghi 54 mã và trỏ api.md §4.2. Hiện có ở: `00-tong-quan.md` (bảng stack §9), `01-yeu-cau/yeu-cau-phi-chuc-nang.md` (ghi chú cuối), `02-nghiep-vu/dong-gia.md` (tham chiếu cuối), `05-ke-hoach/quan-ly-rui-ro.md` (tham chiếu cuối), `05-ke-hoach/quy-tac-ky-thuat.md` §11, `04-thiet-ke/kien-truc.md` §11 nếu có.
2. `lo-trinh-thi-cong-web-android.md` §3 và §4 mục 4: ghi chênh lệch 45/54 **đã đóng theo QĐ-02**, giữ liên kết tới QĐ-02.
3. `quy-tac-ky-thuat.md` §3.1: đổi `packages/config/eslint/domain.cjs` thành `packages/config/eslint/domain.mjs` (cú pháp ESM `export`), không đổi danh sách luật cấm.
4. `quy-tac-ky-thuat.md` §5.2: câu mô tả thứ tự khoá thay bằng thứ tự của ADR-014 (chép đúng thứ tự trong ADR, kèm liên kết). Không tự diễn giải thêm.
5. `npm run check:docs` xanh (link, Mermaid, mã định danh).

## Ngoài phạm vi

- `csdl.md` (số bảng 36/42 sửa trong HB-005), `api.md`, mọi file mã.

## Cổng phải xanh

`pnpm check:scope` · `npm run check:docs`
