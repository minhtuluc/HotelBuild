---
id: HB-168
title: NOTI — danh sách, gửi lại ≤ 3 lần cách 5 phút, worker gửi; gộp mailer HB-028
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/api/src/modules/noti/**
  - apps/api/src/infrastructure/mail/**
  - apps/worker/src/**
  - apps/worker/test/**
  - apps/api/test/notifications/**
---

# HB-168 — NOTI — danh sách, gửi lại ≤ 3 lần cách 5 phút, worker gửi; gộp mailer HB-028

## Mục tiêu

Mọi thông báo gửi khách được ghi lại kèm trạng thái; gửi lại có giới hạn; mailer của HB-028 trở thành kênh email của module này.

## Căn cứ

- api.md §2.11; UC-NOTI-01, UC-NOTI-02; BR-SYS-06; TC-NOTI-01, TC-NOTI-02; csdl §3 `notifications`
- Phụ thuộc: HB-006, HB-160, HB-028, HB-013, HB-014, HB-009

## Tiêu chí nghiệm thu

1. Gửi qua worker (không chặn request); `retry_count` tối đa 3, cách ≥ 5 phút; sau 3 lần → FAILED + cảnh báo nhân viên.
2. Thông báo xác nhận booking/thanh toán/huỷ phát từ sự kiện nghiệp vụ (outbox nếu đã có HB-130, nếu chưa thì gọi trực tiếp sau commit — ghi lựa chọn).
3. Kênh SMS/Zalo là adapter giả lập cho tới khi có nhà cung cấp; không log nội dung chứa PII.
4. TC-NOTI-01, TC-NOTI-02.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
