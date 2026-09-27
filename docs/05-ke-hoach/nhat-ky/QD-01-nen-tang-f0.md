# QĐ-01 — Quyết định nền tảng thi công F0

**Ngày:** 27/09/2026 · **Phạm vi:** pha F0 của [lộ trình thi công 4 frontend](../lo-trinh-thi-cong-web-android.md) · **Người lập:** nhóm thi công · **Cần chốt với chủ sở hữu:** các mục đánh dấu *cần xác nhận*.

Các mục dưới đây là quyết định kỹ thuật **trong repository**. Mục nào đụng tới hợp đồng nghiệp vụ hoặc cấu hình của chủ đầu tư thì được ghi rõ là giả định dùng tạm, không phải phê duyệt.

| # | Quyết định | Lý do | Phương án bị loại | Trạng thái |
|---|---|---|---|---|
| 1 | Workspace dùng **pnpm** (`pnpm-workspace.yaml`, `pnpm-lock.yaml`), `node-linker=hoisted`, bỏ `package-lock.json` | Quy tắc kỹ thuật §12.1.1 yêu cầu pnpm; linker phẳng là yêu cầu của Metro/Expo | Giữ npm workspace: lệch quy tắc đã chốt; hai lockfile song song: CI nhập nhằng | Đã quyết định |
| 2 | Công cụ kiểm tài liệu giữ nguyên lệnh `npm run …` nhưng chạy được bằng pnpm; CI tài liệu chuyển sang pnpm | Không phá hợp đồng CI hiện có, chỉ đổi trình quản lý gói | Viết lại toàn bộ script tài liệu: rủi ro không cần thiết | Đã quyết định |
| 3 | **Hợp đồng API là OpenAPI 3.1 sinh từ zod**, commit tại `packages/contracts/openapi.json`; CI so khớp byte-level; mọi release gate ghi rõ contract version (ADR-018 cổng 4) | Catalogue Markdown không phải hợp đồng sinh tự động (hướng dẫn thi công §5); so byte-level phát hiện mọi lệch | Sinh lại rồi so cấu trúc: bỏ lọt lệch có chủ đích; không commit: client không có mốc tham chiếu | Đã quyết định |
| 4 | Danh mục mã lỗi bám **bảng 54 dòng của api.md §4.2** | Bảng §4.2 là nguồn đầy đủ; bỏ mã là lỗi hiển thị | Bám con số "45 mã" ở ba tài liệu khác: sẽ thiếu 9 mã | Đã quyết định — **cần xác nhận** để ba tài liệu kia sửa theo (CRF) |
| 5 | Mã tương quan gửi đi là `X-Correlation-Id`; đọc `X-Trace-Id`, `Idempotency-Replayed`, `ETag` từ phản hồi | Kiến trúc §9 đặt `X-Correlation-Id`; api.md §1.5 quy định các header phản hồi | Tự đặt header mới: lệch hợp đồng | Đã quyết định |
| 6 | `pinToken` được chèn vào **thân yêu cầu** cho endpoint tài chính, không phải header | api.md §2 liệt kê `pinToken` trong cột yêu cầu của endpoint 🔒 | Suy ra header `X-Pin-Token`: không có trong tài liệu | Đã quyết định |
| 7 | Cấu hình validate bằng zod ở biên; **chỉ** `apps/*/src/config` đọc `process.env`; web app có `/api/ready` chạy động | Kiến trúc §7.5, NFR-MAIN-05; route động giữ `next build` không phụ thuộc biến môi trường | Đọc env rải rác: khó kiểm, dễ lộ secret | Đã quyết định |
| 8 | React dùng **một phiên bản 19.2.3** cho cả workspace; React Native 0.86.3, Expo SDK 57 | Expo SDK 57 yêu cầu react 19.2.3; hai bản React gây lỗi hook khi chạy test | Giữ react 19.3 cho web: phát sinh hai bản React trong cây phụ thuộc | Đã quyết định |
| 9 | TypeScript giữ **5.9.3** dù `expo install --check` gợi ý 6.0.3 | ADR-001 chốt TypeScript 5.x cho toàn monorepo | Nâng TS 6 riêng cho app Android: hai phiên bản TS trong một workspace | Đã quyết định — **cần xác nhận** khi nào nâng TS 6 |
| 10 | Tương thích specifier `.js` (NodeNext) với bundler: `extensionAlias` cho Next, shim resolver cho Metro | Gói dùng chung viết theo NodeNext; Metro không tự ánh xạ `.js` → nguồn TS | Bỏ đuôi `.js`: hỏng khi worker/API chạy Node ESM | Đã quyết định |
| 11 | `packages/ui-web` tách `messages.ts` (thuần, dùng được ở server) khỏi `i18n.tsx` (`'use client'`) | Hàm trong module `'use client'` không gọi được từ server component | Đánh dấu cả trang là client: mất render phía server và SEO | Đã quyết định |
| 12 | `packages/ui-native` nhập `ScreenState` bằng `import type` từ `packages/ui-web` | Một định nghĩa duy nhất cho hợp đồng 9 trạng thái; không tạo phụ thuộc runtime | Chép lại kiểu: trôi nghĩa giữa hai nền tảng | Đã quyết định |
| 13 | Phạm vi ESLint: loại `docs/`, `scripts/`, `tests/`; harness E2E được `tsc` kiểm riêng (`typecheck:e2e`) | Công cụ tài liệu có CI riêng; tránh cấu hình project-service cho tệp ngoài tsconfig | Ép mọi tệp vào lint type-aware ngay: rủi ro đỏ giả | Đã quyết định |
| 14 | Artefact sinh tự động (`packages/contracts/openapi.json`) nằm trong `.prettierignore` | Định dạng lại làm lệch so khớp byte-level của cổng hợp đồng | Cho Prettier sửa rồi so cấu trúc: mất tính tất định | Đã quyết định |
| 15 | Chưa tạo `packages/domain` và preset ESLint purity trong F0 | Gói chưa tồn tại; cấu hình cho mã không có là khối lượng chết | Tạo trước: không có gì để kiểm | **Cần xác nhận** — preset purity sẽ vào cùng `packages/domain` ở pha backend |

## Việc phải theo dõi sau F0

1. Ba tài liệu (`00-tong-quan` §6, yêu cầu phi chức năng NFR-MAIN-04, quy tắc kỹ thuật §11) còn ghi "45 mã lỗi" — mở CRF để chủ sở hữu tài liệu cập nhật thành 54.
2. Chưa có WebKit trong cổng E2E cục bộ (NFR-USE-04 cần 2 bản Safari gần nhất); workflow đêm đã cài `chromium webkit`, cần log CI thật để đạt.
3. EAS build (2 application ID) và Maestro (2 Android) chưa có artefact; chờ credentials và các màn hình F1–F7.
