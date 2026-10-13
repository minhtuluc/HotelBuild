# HB-183 — bản vá dependency ngày 14/10/2026

Phần độc lập: cập nhật các dependency có bản vá phát hành và thêm hồi quy chạy trong `pnpm run ci`. **Toàn HB-183 còn OPEN**: audit còn lỗi high chưa có bản vá, chưa có staging/pentest, CodeQL/Trivy và cơ chế thời hạn CVSS chưa được nghiệm thu. Tình trạng GitHub Actions ở cấp repo hiện là tắt; bằng chứng local không thay trạng thái hosted CI.

## Kết quả audit

`pnpm audit --audit-level=high --json` trên nền main1135245 trả EXIT1: **3 critical, 11 high, 11 moderate, 1 low**. Sau cập nhật thử: **0 critical, 2 high, 6 moderate, 1 low**, vẫn EXIT1. Đây là phân loại của registry; một số advisory chưa có điểm CVSS và khác nhãn mức độ ở trang maintainer. Không suy diễn điểm số hay mức tiếp cận endpoint từ nhãn audit.

## Phiên bản được ghim

Overrides có giới hạn theo consumer/phiên bản bị ảnh hưởng; không đổi major Next/Nest/Prisma/Vitest/Expo.

| Consumer | Trước → sau | Nguồn bản vá |
| --- | --- | --- |
| Nest adapter11.2.7 → Fastify | 5.11.3 → 5.12.5 | [Fastify malformed URL](https://github.com/fastify/fastify/security/advisories/GHSA-p68q-wchp-6fh7); bản vá từ5.12.2. Bản5.12.5 đã là direct dependency đang dùng; thay bản cũ lồng trong adapter. |
| Next15.5.26 → PostCSS | 8.4.31 → 8.5.28 | [PostCSS source-map traversal](https://github.com/postcss/postcss/security/advisories/GHSA-r28c-9q8g-f849); bản vá từ8.5.18. Bản8.5.28 đã dùng bởi Tailwind. |
| Prisma config6.19.3 → deepmerge-ts | 7.1.5 → 8.0.2 | [deepmerge-ts8](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0), sửa vòng tham chiếu. Chỉ ghim consumer config; Prisma vẫn6.19.3. |
| Vitest3.2.7 → Tinypool | 1.1.1 → 2.1.2 | [Constructor options](https://github.com/tinylibs/tinypool/security/advisories/GHSA-5gmw-xhrv-c9v3), [run options](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr). Vitest vẫn3.2.7; cần kiểm pool API và toàn bộ suite. |
| Source-map-js | 1.2.1 → 1.2.2 | [Bản vá offset/khuếch đại map](https://github.com/7rulnik/source-map-js/pull/79) |
| Sharp | 0.35.4 → 0.35.5 | [librsvg](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w); kiểm binding native và render SVG tổng hợp. |
| Shell-quote | 1.10.0 → 1.11.0 | [Ký tự kết dòng sau comment](https://github.com/ljharb/shell-quote/security/advisories/GHSA-pqg4-j6r4-53mv) |

Node22 đáp ứng engine của các bản được chọn. Deepmerge8 thay ngữ nghĩa merge giá trị Map; cấu hình Prisma hiện dùng record và đường dẫn, được kiểm qua CLI6 tải config thật và validate schema tạm. Hồi quy chu kỳ kiểm chính dependency mà Prisma resolve; cấu hình dùng Map tuỳ biến cần đối chiếu thay đổi này trước khi thêm. Overrides nên được đối chiếu và bỏ khi consumer phát hành dependency đã vá tương ứng.

## Hồi quy và tương thích

`pnpm check:dependency-security` dùng Node test, module resolve từ **consumer thực**, không mock thư viện:

- Fastify lồng trong Nest: malformed URL không gọi fallback riêng của sibling; request hợp lệ vẫn giữ kiểm quyền.
- Tinypool của Vitest: hai tiến trình con sở hữu riêng thử thuộc tính `filename`/`execArgv` kế thừa. Worker chỉ trả marker tổng hợp; heap64MiB và timeout10 giây, dọn trong `finally`.
- Shell-quote của React Native tooling: bốn ký tự kết dòng sau comment phải bị từ chối; đối số bình thường vẫn round-trip.
- Deepmerge của Prisma: record có vòng tham chiếu hợp nhất hữu hạn; Prisma6 CLI thực tải config rồi validate schema tạm, không kết nối CSDL.
- Source-map consumer từ coverage tool: offset khuếch đại bị chặn ngay khi parse, không tạo output khổng lồ.
- Sharp của Next: binding native chạy và tạo PNG2×3 từ SVG sở hữu riêng.

Trước nâng dependency,9 ca lỗi thật và2 ca tương thích qua. Bản thử sau nâng qua các ca trên; bằng chứng cuối phải gắn đúng SHA sạch, gồm frozen install, CI/docs, API/worker integration, cả E2E, Hermes và API/PostgreSQL/Next chạy thật. Báo cáo bàn giao ngoài repo giữ cả RED và lỗi harness ban đầu; không gọi log phát triển là bằng chứng commit cuối.

## Hai lỗi high còn chặn

- **node-forge1.4.0** qua Expo CLI: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [thảo luận upstream](https://github.com/digitalbazaar/forge/issues/1149). Registry hiện không có bản vá phát hành. Các PR RSA verifier còn cần maintainer chốt; phần này giữ nguyên thư viện và cảnh báo.
- **braces3.0.3** qua Expo Metro/micromatch: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [upstream](https://github.com/micromatch/braces/issues/70). Registry hiện không có bản vá phát hành.

Hai đường này nằm trong công cụ phát triển/build; điều đó không miễn chúng khỏi yêu cầu phát hành. Audit vẫn thất bại và release chưa được coi đạt HB-183. Không thêm ignore/baseline audit, không tắt dependency để làm xanh, không tự chấp nhận rủi ro hoặc backport crypto chưa được maintainer duyệt. Cần bản vá upstream hoặc quyết định thay dependency có kiểm chứng tương thích; staging/pentest vẫn là phần việc riêng.

## Phạm vi tự quyết

Root `package.json`, lockfile và hồi quy `infra/security/` ngoài allow của HB-183 là các file cần để sửa dependency và kiểm bản cài thực; AGENTS §4 cho phép giải trình helper/file nhỏ ngoài allow. Không sửa hợp đồng, BR, ticket, test khoá hay cấu hình bảo vệ. `pnpm run ci` giữ các cổng cũ và thêm hồi quy; trạng thái audit còn lỗi được báo riêng, không nhận toàn bộ security job/CVSS gate đã hoàn tất.
