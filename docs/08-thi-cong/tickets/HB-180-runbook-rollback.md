---
id: HB-180
title: Runbook rollback production + diễn tập trên staging
risk: R2
owner: codex
max_lines: 300
allow:
  - docs/07-ban-giao/van-hanh/**
  - scripts/**
---

# HB-180 — Runbook rollback production + diễn tập trên staging

## Mục tiêu

Biết chính xác cách quay lại khi bản phát hành lỗi mà không mất tiền/tồn.

## Căn cứ

- csdl §8.4; NFR-REL-04; TC-SYS-09
- Phụ thuộc: HB-178, HB-179

## Tiêu chí nghiệm thu

1. Runbook: quay bản app (image cũ), migration bù tiến (không `down`), PITR khi cần; ai phê duyệt, cấm rollback giờ cao điểm, ghi audit.
2. Diễn tập một lần trên staging, biên bản kèm thời gian từng bước (TC-SYS-09).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
