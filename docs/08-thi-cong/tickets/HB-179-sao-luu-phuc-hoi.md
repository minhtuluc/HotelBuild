---
id: HB-179
title: Backup + diễn tập restore (WAL + full hằng ngày), POST /system/backups, /restore vào môi trường tạm
risk: R2
owner: codex
max_lines: 700
allow:
  - infra/**
  - apps/api/src/modules/sys/backups/**
  - apps/worker/src/**
  - apps/worker/test/**
  - apps/api/test/backups/**
  - docs/07-ban-giao/van-hanh/**
---

# HB-179 — Backup + diễn tập restore (WAL + full hằng ngày), POST /system/backups, /restore vào môi trường tạm

## Mục tiêu

Có thể khôi phục dữ liệu với RPO ≤ 15 phút, RTO ≤ 4 giờ, chứng minh bằng diễn tập thật có biên bản.

## Căn cứ

- BR-SYS-03; NFR-REL-04; api.md §2.13 (`/system/backups`, `/system/backups/{backupId}/restore`, `/operations/{operationId}`); TC-SYS-07; csdl §8.4
- Phụ thuộc: HB-175, HB-178, HB-163

## Tiêu chí nghiệm thu

1. Sao lưu WAL liên tục + full hằng ngày ra nơi off-site theo QĐ hosting; mã hoá; kiểm tra toàn vẹn.
2. API 202 + theo dõi bằng bảng thao tác của HB-163; restore chỉ vào môi trường tạm do máy chủ chọn, không nhận URL từ client.
3. Diễn tập PITR thật trên staging: ghi thời điểm, lượng dữ liệu mất, thời gian khôi phục, đối soát tiền/tồn sau khôi phục; biên bản `docs/07-ban-giao/van-hanh/dien-tap-phuc-hoi-<ngày>.md` (TC-SYS-07).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
