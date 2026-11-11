---
id: HB-235
title: Rà bảng nợ kỹ thuật theo mã thật — đóng mục đã trả, ghi phần còn lại (HB-192 tiêu chí 3, đợt 1)
risk: R0
owner: claude
max_lines: 150
allow:
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/04-thiet-ke/kien-truc.md
  - docs/08-thi-cong/tickets/HB-235-ra-soat-no-ky-thuat.md
---

# HB-235 — Rà nợ kỹ thuật, đợt 1

## Vấn đề

`no-ky-thuat.md` có 63/80 mục chưa đóng (11/11/2026), nhiều mục đã được làm xong mà không ai cập nhật. Ví dụ: TD-15 tự ghi rằng TD-04/05/09/10 "đã được hiện thực hóa" nhưng vẫn để Mở. Bảng không còn cho biết đúng nợ thật, nên không đạt tiêu chí 3 của HB-192.

## Thay đổi (đối chiếu từng mục với mã/hợp đồng hiện tại)

| Mục | Kết quả | Bằng chứng |
| --- | --- | --- |
| TD-04, TD-05, TD-07 | Đóng | Tuyến `GET` có trong api.md và controller tương ứng |
| TD-10 | Đóng | `GET /channel-allotments` trả version theo cặp (HB-035) |
| TD-11 | Đóng | `roomTypeSummarySchema.sellingUnits` |
| TD-15 | Đóng | 04/05/10 đóng; 09 tách riêng |
| TD-19 | Đóng | Đường cộng `used` ở `chan/inbound/inventory.ts` (HB-129) |
| TD-13 | Đóng | Kiến trúc §1 (dòng 4, bảng công nghệ, cây thư mục) sửa idempotency → PostgreSQL; §7 theo HB-175 |
| TD-06, TD-08 | Một phần | Có `GET`; TD-08 thêm `GET/POST` ở HB-236; còn thiếu sửa/ngừng |
| TD-16, TD-24 | Đóng | HB-200/HB-202 đã merge; runner 900 s, CI integration 11,5 phút |
| TD-17 | Đóng | HB-225/228/231 đã merge; k6 200 VU 0 lỗi 5xx |
| TD-09 | Còn mở, gán người nhận và hạn | HB-040 cố ý chưa có đến/đi/ở |

Các mục chạm tiền, tồn, bảo mật (TD-18, TD-23, TD-64, TD-65, TD-66…) xử lý bằng ticket sửa mã riêng, không đóng bằng tài liệu.

## Cổng phải xanh

`npm run check:docs` · `pnpm check:scope`.
