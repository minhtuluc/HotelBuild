---
id: HB-163
title: Xuất báo cáo bất đồng bộ (202 + operationId, worker CSV/XLSX, audit mỗi lần xuất)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/api/src/modules/rep/export/**
  - apps/api/src/modules/sys/operations/**
  - apps/worker/src/**
  - apps/worker/test/**
  - apps/api/test/report-export/**
  - apps/api/prisma/migrations/**
---

# HB-163 — Xuất báo cáo bất đồng bộ (202 + operationId, worker CSV/XLSX, audit mỗi lần xuất)

## Mục tiêu

Kế toán xuất báo cáo lớn mà không treo API; theo dõi tiến trình bằng `operationId`; mỗi lần xuất có audit.

## Căn cứ

- api.md §2.12 (`/reports/export`), `GET /api/v1/operations/{operationId}`; NFR-COMP-04; UC-REP-01; TC-REP-02
- Phụ thuộc: HB-162, HB-006, HB-029

## Tiêu chí nghiệm thu

1. Bảng theo dõi thao tác (migration tiến + sửa csdl §3 cùng PR theo QĐ-02 mục 3) và `GET /operations/{operationId}` kiểm quyền người tạo. HB-179 dùng lại bảng này.
2. Worker sinh CSV/XLSX; 100.000 dòng ≤ 60 giây; tệp lưu tạm có hạn, link tải ký hạn ngắn.
3. Số trong tệp khớp số trên màn hình cho cùng tham số; audit ghi người xuất, báo cáo, tham số.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).

Tài liệu `docs/04-thiet-ke/csdl.md` không bảo vệ (QĐ-04) nên sửa §3 trực tiếp trong PR.
