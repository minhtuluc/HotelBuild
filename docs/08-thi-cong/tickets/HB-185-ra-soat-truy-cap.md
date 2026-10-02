---
id: HB-185
title: Rà accessibility 83 màn hình (6 cấu hình trình duyệt, TalkBack, zoom 200%, 360 px)
risk: R0
owner: gemini
max_lines: 400
allow:
  - tests/e2e/a11y/**
  - docs/07-ban-giao/bang-chung-a11y.md
---

# HB-185 — Rà accessibility 83 màn hình (6 cấu hình trình duyệt, TalkBack, zoom 200%, 360 px)

## Mục tiêu

Không màn hình nào có vi phạm accessibility nghiêm trọng trước UAT.

## Căn cứ

- NFR-USE-03…05; TC-SYS-10; thiết kế màn hình §8
- Phụ thuộc: HB-173, HB-197

## Tiêu chí nghiệm thu

1. axe 0 serious/critical trên mọi màn web; TalkBack đọc được luồng chính Android (BLOCKED nếu không có thiết bị).
2. Danh sách lỗi theo màn + đề xuất sửa để lead giao.

## Cổng phải xanh

`pnpm check:scope` · `npm run check:docs` · log chạy trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
