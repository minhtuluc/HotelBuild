---
id: HB-328
title: Rà nợ kỹ thuật đợt 2 theo mã thật — đóng mục đã trả, dọn TD-32/TD-34/TD-43
risk: R1
owner: claude
max_lines: 400
allow:
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-328-ra-soat-no-ky-thuat-dot-2.md
  - apps/operations-web/src/session/ops-nav.tsx
  - apps/operations-web/src/session/messages.ts
  - apps/operations-web/test/ops-nav.spec.ts
  - apps/operations-android/src/arrivals/**
  - apps/operations-android/test/guest-names.spec.ts
  - apps/operations-android/test/hb210-arrivals-names.spec.ts
  - apps/worker/src/tracing/job-trace-shape.ts
  - apps/worker/src/noti/payload.ts
  - apps/worker/src/export/report-export.job.ts
  - apps/worker/test/job-trace-shape.spec.ts
---

# HB-328 — Rà nợ kỹ thuật, đợt 2

## Vấn đề

Sau HB-235 (11/11/2026), `no-ky-thuat.md` lại lệch mã: TD-71 đã làm ở HB-175 nhưng vẫn ghi Mở, TD-25 chưa ghi HB-215, TD-79 được mã và ticket HB-228 nhắc tới nhưng không có dòng trong sổ. Ba mục còn mở dọn được ngay mà không chạm tiền, tồn, phân quyền hay hợp đồng.

## Thay đổi

| Mục | Kết quả | Bằng chứng |
| --- | --- | --- |
| TD-71 | Đóng (sổ chậm) | `TRUST_PROXY_HOPS` (`apps/api/src/main.ts`, `config/env.ts`), `test/trust-proxy.spec.ts`, `infra/prod` đặt `1` |
| TD-25 | Một phần (sổ chậm) | `POST /refund-requests/{id}/confirm-transfer` (HB-215); còn adapter hoàn VNPay/MoMo |
| TD-79 | Thêm dòng, Đóng | HB-228: caller không mở connection thứ hai trong transaction, `test/holds/pool-starvation.spec.ts` |
| TD-62 | Đóng, gộp vào TD-48/TD-50 | Dòng tự ghi "không có bản vá riêng" |
| TD-43 | Đóng | Thêm menu cho `/admin/users` và sáu màn khác không có đường vào; test `ops-nav.spec.ts` chặn màn mồ côi và link chết |
| TD-32 | Đóng | `jobTraceShape` dùng chung cho payload job do API đẩy; test `job-trace-shape.spec.ts` |
| TD-34 | Một phần | Thẻ SCR-57 hiện hạng thành viên từ `GET /guests/{id}`; còn giờ đến dự kiến (chưa có cột/trường) |
| TD-84 | Mới | `/overbooking/merge-walkout` không có link nào mang `mergeId`/`moveId` |

## Ngoài phạm vi

Mục chạm tiền, tồn, bảo mật hay cần quyết định nghiệp vụ/thiết bị giữ nguyên trạng thái, chỉ đối chiếu lại.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check`
