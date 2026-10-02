---
id: HB-067
title: QA F3 trên API thật — Chromium + WebKit, axe, đối chiếu số liệu
risk: R0
owner: gemini
max_lines: 500
allow:
  - tests/e2e/f3/**
  - docs/07-ban-giao/bang-chung-f3.md
---

# HB-067 — QA F3

## Mục tiêu

Chạy các màn SCR-26…SCR-30, SCR-70 trên **API thật + seed** (không API giả), ghi bằng chứng cho nghiệm thu F3.

## Căn cứ

- TC-RATE-01…12, TC-RATE-21, TC-RATE-22, TC-RATE-27, TC-SYS-11, TC-AUTH-09; [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §9; seed HB-018
- Phụ thuộc: HB-054…HB-063

## Tiêu chí nghiệm thu

1. `tests/e2e/f3/` chạy khi `E2E_REAL_API=1` (`infra:up` + migrate + seed + api); mỗi TC ở trên có một ca hoặc ghi rõ "thuộc ticket backend, đã có test tích hợp".
2. Chromium + WebKit (`E2E_BROWSERS=chromium,webkit`); axe 0 serious/critical trên mọi màn.
3. Giá trên SCR-30 khớp từng VND với `POST /quotes/multi-channel` và với bảng tính tay (động giá §5) ở ít nhất 3 ca.
4. TC-SYS-11 trên SCR-70: 412/428 giữ bản nhập + hiện diff.
5. `docs/07-ban-giao/bang-chung-f3.md` theo mẫu `bang-chung-f0.md`: SHA, ngày, lệnh, kết quả từng TC, mục `NOT_RUN`/`BLOCKED`; lỗi phát hiện ghi thành danh sách để lead giao sửa.
