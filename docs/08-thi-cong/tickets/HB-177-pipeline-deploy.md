---
id: HB-177
title: Pipeline deploy: build image → registry → triển khai cuốn chiếu; web lên Vercel; cổng contract version
risk: R2
owner: codex
max_lines: 500
allow:
  - .github/workflows/**
  - infra/**
  - scripts/**
unlock:
  - .github/workflows/**
---

# HB-177 — Pipeline deploy: build image → registry → triển khai cuốn chiếu; web lên Vercel; cổng contract version

## Mục tiêu

Merge vào `main` deploy staging tự động; deploy production bằng tay có phê duyệt; không gián đoạn; chặn khi hợp đồng không tương thích (ADR-018 cổng 4).

## Căn cứ

- kiến trúc §7 (CI/CD); ADR-018; NFR-MAIN-04
- Phụ thuộc: HB-175, HB-176, HB-178

## Tiêu chí nghiệm thu

1. Image gắn SHA; migration chạy trước khi đổi phiên bản app (HB-178); health check trước khi chuyển lưu lượng; lỗi → giữ bản cũ.
2. Release gate in contract version của từng app; web/Android cũ còn trong cửa sổ tương thích thì không được phá vỡ hợp đồng.
3. Diễn tập: một deploy lỗi có chủ đích trên staging tự quay về bản cũ (log trong PR).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
