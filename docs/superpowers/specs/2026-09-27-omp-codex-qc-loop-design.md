# Vòng kiểm OMP → Codex trong repo OOAD

**Ngày:** 2026-09-27

**Trạng thái:** Chờ duyệt thiết kế bằng văn bản

## Mục tiêu và phạm vi

Khi người dùng giao một tác vụ sửa repo cho phiên OMP tương tác, OMP hoàn tất phần việc rồi Codex tự kiểm thay đổi. Nếu Codex tìm lỗi chặn, feedback trở lại cùng phiên OMP để sửa; Codex kiểm lại cho đến khi đạt hoặc chạm điều kiện dừng. Người dùng không phải gọi Codex hay chuyển feedback thủ công giữa các vòng.

Phạm vi đầu tiên là repo `OOAD`. Người dùng thường mở OMP với `cwd` là thư mục cha `BUILDHOTEL`, còn Git root nằm ở `BUILDHOTEL/OOAD`. Mã extension được theo dõi trong `OOAD/.omp/extensions/`; bước cài đặt một lần tạo liên kết tại `BUILDHOTEL/.omp/extensions/` để OMP tự nạp khi khởi chạy từ thư mục cha. Vòng kiểm áp dụng cho thay đổi mã, cấu hình, kiểm thử và tài liệu trong repo. Nó không tự commit, merge, push hoặc triển khai.

## Cách tiếp cận

| Cách | Ưu điểm | Hạn chế |
| --- | --- | --- |
| Extension OMP dùng `session_stop` **(chọn)** | Tự kích hoạt đúng khi phiên OMP sắp dừng; feedback tiếp tục trong cùng ngữ cảnh | Cần OMP hỗ trợ stop hook và liên kết extension ở `cwd` thật |
| Script bao ngoài chạy hai CLI tuần tự | Dễ kiểm soát tiến trình batch | Phải bắt đầu tác vụ qua script; không gắn trực tiếp vào phiên OMP tương tác hiện có |
| OMP tự gọi lệnh Codex theo prompt | Ít mã phụ trợ | Phụ thuộc OMP nhớ làm; khó giới hạn vòng và kiểm tra lỗi hệ thống |

## Thành phần và giao diện

1. `OOAD/.omp/extensions/codex-qc.ts`: đăng ký `session_stop` cho phiên chính. Extension chụp trạng thái Git của `OOAD` trước tác vụ, chỉ gọi QC nếu trạng thái repo thay đổi, chuyển feedback thành `additionalContext`, và trả `{ continue: true }` khi cần sửa.
2. Bước cài đặt trong `OOAD/scripts/agent-qc/` tạo liên kết `BUILDHOTEL/.omp/extensions/codex-qc.ts` trỏ đến extension được Git theo dõi. Vì OMP chỉ tự tìm extension tại `cwd`, liên kết này giúp phiên khởi chạy từ `BUILDHOTEL` nạp đúng module mà không phải sao chép mã.
3. Module điều phối trong `OOAD/scripts/agent-qc/`: xác định Git root `OOAD` từ vị trí extension, lấy dấu vân tay của `HEAD`, diff và file chưa theo dõi; gọi Codex với `-C OOAD`, sandbox `read-only`, giới hạn thời gian và dung lượng đầu ra; kiểm tra phản hồi theo JSON schema cố định.
4. Trạng thái phiên giữ số vòng, dấu vân tay đã kiểm, và các lỗi chặn trước đó. Nhật ký mỗi vòng nằm trong thư mục bị Git bỏ qua để người dùng tra lại. Không đưa nhật ký vào diff cần review.
5. Codex trả `PASS`, `NEEDS_CHANGES` kèm vị trí/lý do cụ thể, hoặc `BLOCKED` khi không thể xác minh. OMP chỉ nhận feedback của đúng dấu vân tay vừa được kiểm.

## Luồng xử lý

1. Khi tác vụ người dùng bắt đầu, extension ghi mốc `HEAD` và trạng thái worktree. Một lượt hỏi đáp không đổi repo sẽ dừng bình thường, không gọi Codex.
2. Tại `session_stop`, extension lấy lại trạng thái. Nếu có thay đổi, module điều phối yêu cầu Codex kiểm thay đổi từ mốc tác vụ, gồm commit mới, thay đổi chưa commit và file chưa theo dõi.
3. Nếu Codex trả `NEEDS_CHANGES`, extension thêm feedback có cấu trúc vào ngữ cảnh và yêu cầu OMP tiếp tục. Sau khi OMP sửa xong, bước 2 lặp lại.
4. Nếu Codex trả `PASS`, extension ghi kết quả và để OMP dừng. Nếu lệnh Codex lỗi, phản hồi không hợp lệ, diff đổi trong lúc review, hoặc hết giới hạn vòng, extension báo trạng thái `BLOCKED` và dừng tự động để người dùng xem nhật ký.

Giới hạn mặc định là 3 vòng Codex cho một tác vụ, thấp hơn giới hạn 8 lần tiếp tục của OMP. Nếu cùng một lỗi chặn xuất hiện lại mà không có thay đổi repo liên quan, vòng kiểm dừng sớm. Mỗi lượt chỉ có một tiến trình Codex. Codex không được sửa file; OMP không chạy song song trong lúc Codex kiểm.

## An toàn và lỗi

- Không kết luận đạt chỉ từ mã thoát 0 của CLI. Cần JSON hợp lệ, đúng schema, `PASS` và không có lỗi chặn.
- Nếu trạng thái repo thay đổi trong lúc Codex kiểm, bỏ kết luận cũ. Không chuyển feedback của diff cũ thành yêu cầu sửa.
- Nếu phiên bị hủy, tiến trình Codex đang chạy được hủy theo. Nếu Codex không sẵn sàng hoặc xác thực thất bại, dừng vòng và hiển thị lỗi rõ ràng.
- Review là cổng hỗ trợ kiểm chất lượng, không thay thế các lệnh kiểm thử của repo hay quyết định nghiệm thu nghiệp vụ của người dùng.

## Kiểm chứng

- Kiểm thử tự động với Codex giả: không đổi repo thì không review; có lỗi chặn thì OMP tiếp tục; `PASS` thì dừng; JSON sai, timeout, diff cũ và quá 3 vòng đều dừng an toàn.
- Chạy thử extension với OMP ở chế độ không gọi model thật để xác nhận nạp module và nhận đúng sự kiện.
- Chạy một vòng thực tế trên thay đổi nhỏ trong repo khi môi trường CLI và xác thực cho phép; đối chiếu nhật ký, feedback và trạng thái Git sau vòng.

## Cách sử dụng

Chạy bước cài đặt liên kết một lần, rồi mở hoặc nạp lại OMP từ `BUILDHOTEL` như hiện tại. Sau đó giao tác vụ như thường lệ; khi OMP kết thúc lượt có thay đổi trong `OOAD`, QC tự chạy. Nhật ký cung cấp lý do dừng và kết quả từng vòng. Có thể tạm tắt extension qua cấu hình OMP nếu cần làm việc không có QC.
