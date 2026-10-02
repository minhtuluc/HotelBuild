---
id: HB-181
title: Quan sát: OpenTelemetry, log JSON có correlationId/che PII, bảng SLO, cảnh báo burn-rate
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/src/**
  - apps/worker/src/**
  - infra/**
  - apps/api/test/observability/**
---

# HB-181 — Quan sát: OpenTelemetry, log JSON có correlationId/che PII, bảng SLO, cảnh báo burn-rate

## Mục tiêu

Phát hiện sự cố trong ≤ 5 phút và lần ra từng request qua api/worker.

## Căn cứ

- kiến trúc §9; NFR-OBS-01…03; NFR-SEC-03; QĐ quan sát ở lộ trình §5 mục 4
- Phụ thuộc: HB-175

## Tiêu chí nghiệm thu

1. Trace W3C xuyên api → worker (qua job/outbox); lấy mẫu ≥ 10%, 100% với lỗi và thanh toán.
2. 100% dòng log có `traceId`/`correlationId`; kiểm tự động không có PII/token trong log mẫu.
3. Bảng SLO (tỉ lệ lỗi, p95, hàng đợi, giữ chỗ hết hạn đúng hạn) + cảnh báo burn-rate tới kênh kỹ thuật.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
