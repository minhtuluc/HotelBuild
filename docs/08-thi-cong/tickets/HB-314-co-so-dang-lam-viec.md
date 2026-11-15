---
id: HB-314
title: TD-44 phần 2 — lưới tồn, lịch giá, bốn báo cáo, SCR-40/43/47 mở ở cơ sở đang làm việc và đi theo khi đổi trên thanh ngữ cảnh
risk: R1
owner: claude
max_lines: 800
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-314-co-so-dang-lam-viec.md
unlock:
  - docs/08-thi-cong/tickets/HB-314-co-so-dang-lam-viec.md
---

# HB-314 — TD-44 phần 2: cơ sở đang làm việc cho các màn vận hành còn lại

> Đặc tả do frontend lead soạn theo [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (HB-314) và TD-44 trong [sổ nợ kỹ thuật](../../07-ban-giao/no-ky-thuat.md). Phần 1 là HB-308 (SCR-23, SCR-27).

## Vấn đề

Nhân viên chọn cơ sở đang làm việc trên thanh ngữ cảnh (HB-020), nhưng nhiều màn vẫn tự mở ở cơ sở đầu danh sách (lưới tồn, lịch giá, SCR-40) hoặc ở "toàn chuỗi" (bốn báo cáo, SCR-43, SCR-47), và không đổi theo khi người dùng đổi cơ sở.

## Thay đổi

1. **`lib/working-property.ts` › `chooseProperty`:**
   - Thứ tự ưu tiên: lựa chọn trên màn > cơ sở đang làm việc > cơ sở đầu danh sách.
   - Chỉ nhận id có trong danh sách máy chủ trả.
   - Bảng ngày (HB-308) dùng lại hàm này.
2. **`session/staff-session.tsx` › `useWorkingPropertyId()`:** cơ sở đang làm việc, hoặc `''` khi màn chạy ngoài phiên (trạng thái ép, test).
3. **Lưới tồn, lịch giá:** mở ở cơ sở đang làm việc. Đổi cơ sở trên thanh ngữ cảnh thì dựng lại lưới, còn lịch giá bỏ lựa chọn cũ.
4. **Bốn báo cáo** (công suất, doanh thu theo kênh, huỷ, quá tải):
   - Bộ lọc khởi tạo bằng cơ sở đang làm việc; vẫn chọn được "tất cả" trên màn.
   - `useFollowWorkingProperty` cập nhật bộ lọc khi đổi cơ sở.
5. **SCR-40, SCR-43, SCR-47:** bộ lọc/lựa chọn mở màn bằng cơ sở đang làm việc; dựng lại bộ điều khiển khi đổi cơ sở. SCR-47 thêm `filter` vào tuỳ chọn controller.

## Tiêu chí nghiệm thu

1. Unit `test/working-property.spec.ts`; toàn bộ unit operations-web đạt.
2. E2E operations-web (lưới tồn, lịch giá, báo cáo, SCR-40/43/47, a11y) đạt trên bản build production.
3. Typecheck, lint đạt; không có cast `as` mới.
4. Không thêm quy tắc phân quyền ở frontend: phạm vi cơ sở vẫn do máy chủ quyết.

## Ngoài phạm vi (ghi lại ở TD-44)

- Danh sách booking (ô "Cơ sở" vẫn là ô nhập mã; cần đổi sang ô chọn có danh sách).
- Form tạo hạng phòng, ghi đè kênh, đối soát, khoá phòng, báo giá đa kênh, khách thân thiết.
- Người dùng: phạm vi cơ sở của tài khoản do quản trị gán, không phải "cơ sở đang làm việc".
