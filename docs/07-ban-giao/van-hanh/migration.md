# HB-178 — runbook migration chỉ tiến

Phạm vi: thủ tục AC3 của [HB-178](../../08-thi-cong/tickets/HB-178-migration-production.md), theo [csdl §8.2–8.4](../../04-thiet-ke/csdl.md#8-chiến-lược-migration) và [QĐ-02 mục 2–4](../../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md). Cổng AC2 nằm trong [kiểm sau migration](migration-post-checks.md). Việc có thủ tục và diễn tập SQL cục bộ **không** nghiệm thu snapshot, staging hay production: AC1 vẫn BLOCKED khi HB-175/HB-179 chưa cung cấp môi trường và bằng chứng.

## 1. Điều kiện trước khi bắt đầu

- Có SHA đã qua review/CI, danh sách migration mới và checksum; image/digest bản hiện tại và bản dự kiến; hợp đồng/version của cả web, Android và worker còn hoạt động. Không sửa migration đã phát hành, checksum hoặc lịch sử bằng SQL tay.
- Có bản sao staging từ nguồn được uỷ quyền và kế hoạch bảo vệ dữ liệu; không lấy PII hay credential đưa vào log. Đo trước thời gian, dung lượng, tác động khoá trên bản sao có dữ liệu đại diện. Migration dự kiến trên 30 giây phải vào cửa sổ bảo trì ngoài giờ cao điểm (csdl §8.2).
- Có snapshot trước migrate và mốc PITR, mã snapshot, nơi lưu off-site/mã hoá, thời điểm phục hồi và bằng chứng kiểm khôi phục của HB-179. Thiếu bằng chứng này thì **dừng**, không coi migration local là giấy phép chạy production.
- Có đúng PostgreSQL 16, role chủ qua `DATABASE_MIGRATION_URL` và runtime `app_rw` qua `DATABASE_URL`; credential cấp riêng cho tiến trình, không ghi URL vào shell history hoặc log. Không chạy `db:dev-roles`, seed tài khoản dev hay `migrate dev` trên production.
- Chỉ một triển khai được quyền thay đổi cùng database. Cổng tuần tự nằm ở orchestrator/pipeline HB-177, không được coi một lệnh advisory-lock rồi thoát connection là khoá cả lần deploy. Nếu chưa có cơ chế tuần tự và quyền vận hành thì dừng.

Chạy cùng **một SHA/migration set** trên bản sao phiên bản trước và staging trước production. Luồng kiểm local/CI trên database trống không thay thế rehearsal nâng cấp có dữ liệu thật được bảo vệ.

## 2. Expand — giữ ứng dụng cũ hoạt động

1. Thêm schema tương thích ngược bằng migration SQL tiến mới; cột mới ban đầu nullable hoặc có phương án điền dữ liệu đã duyệt, không xoá/đổi tên cột đang được client cũ dùng. Đưa thay đổi schema vào csdl §3 và introspect `schema.prisma` theo QĐ-02; không sinh luật tồn/tiền bằng cách sửa Prisma schema trước.
2. DDL có thể chờ khoá phải có `lock_timeout = '3s'` trên **connection áp DDL**. Timeout của AC2 chỉ áp cho bước kiểm, không tự bao phủ Prisma migrate/DDL/backfill. Với file concurrent-index chỉ có một câu SQL, không thêm SET vào cùng file: cần người vận hành cấp default 3s cho đúng role migration trong đúng database, kiểm inheritance trên connection migrator mới. Không đặt default toàn cluster hay đổi `app_rw`. CLI hiện tại không tự cấu hình default này; chưa chứng minh được timeout của migrator thì dừng production. Chọn `statement_timeout` phù hợp số liệu rehearsal; ghi giới hạn và thời lượng, không tự tăng lock timeout để vượt lỗi.
3. `CHECK` trên bảng lớn: thêm `NOT VALID`, backfill theo kế hoạch, rồi `VALIDATE CONSTRAINT` ở bước riêng. Không công bố đã bảo vệ toàn bộ dữ liệu cũ trước khi validate đạt.
4. Chỉ mục trên bảng đang phục vụ dùng `CREATE INDEX CONCURRENTLY` ngoài transaction. Với Prisma 6, mỗi concurrent-index phải là **một file migration riêng chỉ chứa đúng một câu SQL**; không kèm SET, truy vấn kiểm hay câu tạo chỉ mục thứ hai. Chỉ bỏ BEGIN/COMMIT chưa đủ: nhiều câu trong một simple-query message tạo transaction ngầm theo [PostgreSQL 16 §55.2.2.1](https://www.postgresql.org/docs/16/protocol-flow.html#PROTOCOL-FLOW-MULTI-STATEMENT). Rehearsal bằng đúng Prisma 6 của repo xác nhận batch SET/DDL/index trả 25001. Kiểm timeout và catalog ở bước/connection phù hợp, không gộp vào file index; chạy thật bản sao trước khi phát hành.

Mẫu sau **chỉ dùng trên database diễn tập riêng có bảng tổng hợp**, không phải migration nghiệp vụ để sao chép vào production. Bảng có PK để cổng AC2 vẫn có nghĩa; không chứa tiền, tồn hay dữ liệu khách:

Các câu sau có thể nằm trong file expand; lock timeout 3s đã được cấp và xác nhận trên connection migrator như trên.

```sql
CREATE TABLE IF NOT EXISTS public.hb178_rehearsal (
  id integer PRIMARY KEY,
  legacy_label text NOT NULL
);
ALTER TABLE public.hb178_rehearsal ADD COLUMN IF NOT EXISTS label_v2 text;
```

File migration kế tiếp chỉ có một câu, không ghép với block trên hoặc truy vấn kiểm bên dưới:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS hb178_rehearsal_label_v2_idx
  ON public.hb178_rehearsal (label_v2);
```

Không copy toàn bộ các block thành một migration hay một lần `client.query` nhiều câu. Cơ chế transaction ngầm cũng áp cho client SQL khác nếu gửi nhiều câu trong cùng simple-query message.

`IF NOT EXISTS` chỉ tránh trùng tên, **không** xác nhận đúng schema hoặc chỉ mục hợp lệ. Sau tạo/chạy lại phải đối chiếu định nghĩa đã review và kiểm catalog:

```sql
SELECT i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
  FROM pg_index i
 WHERE i.indexrelid = 'public.hb178_rehearsal_label_v2_idx'::regclass;
```

Thiếu chỉ mục, `indisvalid/indisready` không phải true hoặc sai định nghĩa đều dừng. Build concurrently bị gián đoạn có thể để lại chỉ mục INVALID; chạy lại với `IF NOT EXISTS` có thể vẫn trả thành công mà không xây lại, theo [PostgreSQL 16 — xây chỉ mục đồng thời](https://www.postgresql.org/docs/16/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY). Không xoá một chỉ mục đang phục vụ chỉ vì trùng tên: điều tra dependency, lập SQL bù tiến được review rồi diễn tập lại; mọi thao tác concurrent vẫn ngoài transaction.

## 3. Migrate — dữ liệu và phiên bản cùng tồn tại

1. Triển khai ứng dụng tương thích cả schema cũ/mới sau khi expand và AC2 đạt. Cách đọc/ghi chuyển tiếp phải được thiết kế theo use case; không tự đặt dual-write cho ledger, tính lại giá, đổi tồn, vô hiệu trigger hoặc sửa audit append-only.
2. Backfill theo khoá ổn định thành lô hữu hạn, mỗi lô transaction ngắn và có điểm tiếp tục/điều kiện idempotent. Đối chiếu số dòng, giá trị và ảnh hưởng nghiệp vụ trước/sau. Dữ liệu phát sinh đồng thời phải có đường xử lý đã duyệt; không dùng một UPDATE dài không giới hạn để thay rehearsal.
3. Với bảng tổng hợp ở trên, một lô ví dụ là `UPDATE public.hb178_rehearsal SET label_v2 = legacy_label WHERE id > 0 AND id <= 100 AND label_v2 IS NULL;`. Kiểm tra lô chưa điền hết và chạy lại không đổi dữ liệu đã điền. Đây không phải quy tắc backfill cho bảng production.
4. Validate `CHECK` mới và kiểm chỉ mục hợp lệ, chạy lại AC2, gọi endpoint thật bằng runtime `app_rw`, theo dõi lỗi và độ trễ. Không coi chỉ có exit 0 của Prisma là đủ.

Lệnh chuẩn của repo, với credential đã được cấp qua môi trường riêng:

```sh
pnpm migrate
```

Lệnh áp migration mới bằng role chủ rồi kiểm ba bất biến §8.3. Bất kỳ mã thoát khác 0 đều dừng pipeline **trước** đổi phiên bản app/chuyển lưu lượng. Các migration đã áp trước lỗi có thể vẫn còn hiệu lực. Không chạy lệnh production qua pipeline bỏ qua exit code, `continue-on-error`, hay giả định có transaction bao toàn bộ file.

Trong CI/bản sao tạm có quyền tạo database, chạy thêm `pnpm db:drift`, kiểm migration trên database trống và snapshot schema phiên bản trước. Shadow database phải riêng; không dùng database đang phục vụ làm shadow. Prisma-generated client là artefact build, không sửa lịch sử migration để hợp datamodel.

## 4. Contract — chỉ thu hẹp sau khi hết client cũ

- Xác nhận mọi web/Android/worker còn trong cửa sổ tương thích dùng schema mới; ghi phiên bản và bằng chứng không còn truy cập trường cũ. Không tự đặt số ngày cửa sổ hoặc suy luận mọi Android đã cập nhật từ việc web deploy xong.
- Chỉ sau khi đối soát dữ liệu và xác nhận trên mới thêm migration tiến riêng để siết NOT NULL/bỏ cột hoặc chỉ mục cũ. Đo khoá và rehearsal lại; đặt lock timeout trên connection DDL như bước expand.
- Với dữ liệu tổng hợp, sau khi xác nhận `label_v2 IS NULL` có 0 dòng mới được `ALTER TABLE public.hb178_rehearsal ALTER COLUMN label_v2 SET NOT NULL;` rồi bỏ `legacy_label`. Không chạy các câu này lên dữ liệu production khi chưa đủ bằng chứng chuyển tiếp.
- Chạy lại AC2 và smoke app. Giữ bản app cũ để quay ứng dụng chỉ có ích khi app đó còn tương thích schema sau contract; không tự quay image cũ đã mất cột cần dùng.

## 5. Thất bại và hồi phục

| Dấu hiệu | Hành động |
| --- | --- |
| Prisma/timeout/AC2 lỗi | Dừng phát hành, giữ lưu lượng ở bản tương thích hiện tại, lưu mã lỗi tĩnh và metadata đã che bí mật; không tự retry vòng lặp |
| Schema áp dở hoặc migration history báo failed | Điều tra SQL thực tế và lịch sử bằng tài khoản vận hành được uỷ quyền, chuẩn bị migration/SQL bù tiến được review, diễn tập lại trên bản sao; không sửa checksum, đánh dấu applied giả, chạy down hay tự `migrate resolve` để vượt cổng |
| App mới lỗi, schema expand còn tương thích | Theo thủ tục deploy HB-177 quay app về image/digest đã ghi, kiểm health và AC2; không rollback database tự động |
| Dữ liệu hỏng hoặc không bù tiến an toàn | Theo HB-179/HB-180 diễn tập PITR vào môi trường tạm do máy chủ chọn, đối soát tiền/tồn và outbox trước quyết định chuyển; RPO ≤ 15 phút, RTO ≤ 4 giờ là mục tiêu cần đo, không phải kết quả local |

Rollback theo csdl §8.4 cần `MANAGER`+ phê duyệt, ngoài giờ cao điểm và ghi AuditLog. Nếu đường phê duyệt/audit/phục hồi chưa sẵn sàng thì báo người có thẩm quyền và dừng; không tự cấp quyền hoặc giả lập biên bản. Khôi phục xong phải chạy lại §8.3 và lập biên bản sự cố.

## 6. Nhật ký bắt buộc và giới hạn nghiệm thu

Mỗi môi trường ghi: mã release, SHA/app digest trước–sau, người chạy/phê duyệt, migration/file checksum, snapshot/PITR ID, thời điểm bắt đầu–kết thúc từng phase, thời lượng/khoá/timeout, kết quả ba kiểm tra, kiểm chỉ mục/đối soát dữ liệu, smoke endpoint, quyết định tiếp tục/dừng và liên kết bằng chứng. Không đưa URL mật khẩu, token, PIN hay dữ liệu khách vào nhật ký.

Diễn tập SQL cục bộ dùng database tổng hợp riêng chỉ chứng minh cú pháp, expand/backfill/contract, transaction boundary của concurrent index, nhận diện INVALID index và lock timeout; không chứng minh cửa sổ tương thích client thực tế, snapshot, RPO/RTO hay staging. Không lập biên bản staging giả và không đóng toàn HB-178 từ bằng chứng local. Cần hoàn tất HB-175/HB-179/HB-177 và lần chạy staging → production có nhật ký trước khi nghiệm thu các phần đó.
