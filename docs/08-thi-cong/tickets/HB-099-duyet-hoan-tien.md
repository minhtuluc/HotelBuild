---
id: HB-099
title: Maker-checker hoàn tiền — request/approve/reject/cancel, cấm tự duyệt mọi mức
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/src/modules/pay/refunds/**
  - apps/api/test/duyet-hoan-tien/**
---

# HB-099 — Maker-checker hoàn tiền — request/approve/reject/cancel, cấm tự duyệt mọi mức

## Mục tiêu

Hoàn tiền cần người lập và người duyệt độc lập ở mọi mức tiền; khoản lớn cần MANAGER+; hai yêu cầu cùng nguồn không cùng được giữ hạn mức.

## Căn cứ

- ADR-016; api.md §3.6, §3.7; UC-PAY-04; BR-CANCEL-15…18, BR-PAY-07; TC-PAY-23; QĐ-04 "không nới"
- Phụ thuộc: HB-093, HB-097, HB-015, HB-029, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. Người duyệt = người lập → `E_PAY_SELF_APPROVAL` ở **mọi** mức; > 5.000.000 VND (net toàn sự kiện) cần MANAGER+ (ADR-016).
2. Reserve từ PENDING; reject/cancel trả hạn mức; GROSS/NET và phí hoàn đúng tài liệu.
3. Duyệt đòi `pinToken`; audit đầy đủ; TC-PAY-23 (hai yêu cầu 80% cùng nguồn → một bị từ chối).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Codex có thể viết test khoá rồi giao phần còn lại cho DeepSeek (QĐ-04).
