# HB-178 — cổng kiểm sau migration (AC2)

Phần này hiện thực ba kiểm tra trong [csdl §8.3](../../04-thiet-ke/csdl.md#83-kiểm-thử-bắt-buộc-sau-mỗi-migration). Đây là phần kiểm sau migrate của [HB-178](../../08-thi-cong/tickets/HB-178-migration-production.md); snapshot, staging/production và runbook expand → migrate → contract đầy đủ còn OPEN.

## Chạy

Cấp `DATABASE_MIGRATION_URL` qua môi trường riêng của tiến trình triển khai, tách tài khoản runtime `DATABASE_URL`. Không ghi URL hay mật khẩu vào lệnh lưu lịch sử hoặc log.

```sh
pnpm migrate
```

Lệnh chạy Prisma migrate deploy, thu hồi quyền của các vai trò đọc/ghi ứng dụng trên `_prisma_migrations`, rồi kiểm catalog trong một transaction `REPEATABLE READ READ ONLY`. Các kiểm tra dùng `search_path = pg_catalog, public`, `statement_timeout = 5s`, `lock_timeout = 3s`; kết nối kiểm có timeout 5s. Đây là timeout của bước kiểm, không thay thế timeout/diễn tập của từng migration.

| Kiểm tra | Điều kiện đạt | Mã lỗi tĩnh |
| --- | --- | --- |
| Khoá chính | Không có bảng thường (`relkind = r`) trong `public` thiếu primary key | `MIGRATION_VERIFY_PRIMARY_KEYS` |
| Chống trùng phòng | Hai exclusion của `room_assignments` đúng toàn bộ định nghĩa đã công bố, gồm khoá, khoảng, toán tử và điều kiện `released_at IS NULL` | `MIGRATION_VERIFY_EXCLUSIONS` |
| Audit append-only | `has_table_privilege('app_rw', 'public.audit_logs', 'UPDATE') = false`, gồm quyền qua PUBLIC và vai trò kế thừa | `MIGRATION_VERIFY_AUDIT_UPDATE` |

Định nghĩa exclusion được đối chiếu theo cách PostgreSQL 16 biểu diễn catalog, chỉ chuẩn hoá khoảng trắng. Nâng PostgreSQL hoặc chủ động đổi định nghĩa cần cập nhật kiểm tra theo nguồn thiết kế đã duyệt; không đổi kỳ vọng để bỏ qua drift. Các ràng buộc khác ngoài hai ràng buộc bắt buộc không bị xoá hoặc tự sửa.

Chỉ khi cả ba đạt mới in `Migration deploy succeeded` và trả mã 0. Prisma thất bại, kết nối/truy vấn lỗi hoặc kiểm tra không đạt trả mã khác 0: pipeline phải dừng, không triển khai ứng dụng mới. Lỗi driver được thay bằng thông báo chung, không in SQL/URL/thông tin xác thực.

## Xử lý khi cổng không đạt

Migration đã áp dụng có thể vẫn còn hiệu lực khi bước kiểm trả lỗi. Không chạy down, không sửa migration đã công bố, không tự cấp/thu hồi quyền trên bảng nghiệp vụ để ép cổng xanh. Điều tra bằng tài khoản vận hành được uỷ quyền và quy trình bù tiến của [csdl §8.4](../../04-thiet-ke/csdl.md#84-quy-trình-rollback); xử lý thay đổi qua migration mới được duyệt rồi chạy lại cổng.

Đây là ảnh catalog tại thời điểm kiểm. Cổng không bảo đảm chống thay đổi DDL/ACL do tài khoản đặc quyền thực hiện sau đó, không thay thế khoá triển khai, snapshot/PITR, phân quyền vận hành hay diễn tập staging.

## Bằng chứng và phần còn thiếu

Test `apps/api/test/migration/post-checks.spec.ts` chạy CLI Prisma thật trên database PostgreSQL 16 riêng cho từng ca: chạy lại bình thường; thiếu khoá chính; mất exclusion; exclusion cùng tên nhưng sai khoá hoặc sai predicate; cấp UPDATE audit trực tiếp hoặc qua PUBLIC; lỗi xác thực không lộ bí mật. Không mock migrator và không thay test khoá. Test được chạy tự động bởi bộ kiểm API hiện có.

Kiểm cục bộ không thay cho staging/production: HB-175, snapshot trước migrate, nhật ký triển khai và diễn tập đầy đủ của HB-178 vẫn cần môi trường thật. GitHub Actions đang tắt ở repository nên chưa có bằng chứng CI hosted; giữ trạng thái BLOCKED đó trong bàn giao.

Quyết định tự đưa ra theo AGENTS.md §4: thêm test helper API ngoài allow để kiểm lỗi trên PostgreSQL thật; giữ logic trong script hiện hữu để fixture baseline đóng băng tiếp tục chạy đúng CLI mà không phải sửa oracle hoặc migration đã công bố.
