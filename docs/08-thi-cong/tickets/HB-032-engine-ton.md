---
id: HB-032
title: Engine tồn khả dụng thuần (packages/domain/inventory)
risk: R2
owner: codex
max_lines: 700
allow:
  - packages/domain/src/inventory/**
  - packages/domain/test/inventory/**
---

# HB-032 — Engine tồn khả dụng

## Mục tiêu

Một hàm thuần trả lời "loại phòng X còn bán được bao nhiêu đơn vị cho kỳ [checkIn, checkOut) trên kênh Y" và "phòng vật lý nào trống cả kỳ", đúng BR-INV-01 hai tầng. Dùng chung cho lưới tồn (F2), tìm phòng và giữ chỗ (F4), quá tải (F6).

## Căn cứ

- BR-INV-01 (nguồn chân lý `docs/02-nghiep-vu/quy-tac-nghiep-vu.md`), BR-INV-02, BR-INV-07, BR-PROP-06; ADR-014; UC-INV-02
- [Bàn giao thi công](../../07-ban-giao/huong-dan-thi-cong.md) §2 (ba dòng đầu: hold cùng kênh, block trùng, kỳ không liên tục)
- TC-INV-01…11 trong [kế hoạch kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md); [quy tắc kỹ thuật](../../05-ke-hoach/quy-tac-ky-thuat.md) §3, §8.2

## Tiêu chí nghiệm thu

1. Xuất qua `@pinehill/domain/inventory` (chỉ sửa `src/inventory/index.ts`; khung đã có). Đầu vào là dữ liệu đã nạp sẵn (đơn vị bán, phòng vật lý, block, assignment, demand theo kênh gồm hold còn hạn tại `now` và cam kết chưa gán) và `now` truyền vào — không I/O, không đọc đồng hồ.
2. **Tầng thương mại** theo từng đêm: cung − demand mọi kênh; giữ giá trị âm để phát hiện thiếu (không kẹp về 0); assignment không cộng thêm vào demand đã đếm.
3. **Tầng vật lý**: trừ **hợp** của block và assignment (một phòng bị block hai lần chỉ loại một đơn vị); phòng DOR tính theo giường.
4. Kỳ nhiều đêm: hết nếu **một** đêm hết; trả thêm danh sách phòng vật lý trống **liên tục** cả kỳ — hai phòng trống xen kẽ không được tính là một phòng liên tục.
5. Hold hết hạn (`expiresAt ≤ now`) không còn chiếm tồn dù chưa có job dọn.
6. Test: mỗi ca TC-INV-01…11 có thể chạy ở mức thuần là một test có tên chứa mã TC; ca nào cần CSDL/đồng thời ghi rõ "thuộc HB-076/HB-008" trong test bị `todo`. Thêm test thuộc tính fast-check: thêm block không bao giờ làm tăng tồn; thêm demand không bao giờ làm tăng tồn.
7. Phủ nhánh `packages/domain` ≥ 90% (ngưỡng đã cưỡng chế); `pnpm run ci` xanh.

## Ngoài phạm vi

- Khoá CSDL, endpoint, đọc dữ liệu từ Prisma (HB-035, HB-075, HB-076).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`

## Ghi chú cho người làm

Ba engine HB-032/HB-052/HB-053 chạy song song, mỗi ticket chỉ sở hữu thư mục của mình. Kiểu dùng chung (ngày lưu trú, `Money`) lấy từ `src/shared`/`src/value-objects`, không sửa chúng; cần thêm kiểu chung thì báo lead.
