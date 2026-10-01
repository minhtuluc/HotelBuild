# Vòng kiểm Codex trong OMP

## Cài đặt một lần

Repo thi công nằm trong một thư mục cha (hiện tại: `Clean Build/src`). Từ thư mục cha, chạy:

```sh
node src/scripts/agent-qc/install.mjs
```

Lệnh tạo `<thư mục cha>/.omp/extensions/codex-qc.ts` trỏ đến tệp được theo dõi trong `src/.omp/extensions/`. Chạy lại lệnh là an toàn nếu liên kết vẫn trỏ đúng. Nếu vị trí đích đã chứa tệp hoặc liên kết khác, lệnh báo lỗi và giữ nguyên nội dung hiện có. Sau khi cài, dùng `/reload` trong OMP hoặc khởi động lại OMP.

## Cách hoạt động

OMP có thể chạy từ thư mục cha; extension vẫn lấy Git root từ vị trí thật của mã nguồn. Khi agent chính bắt đầu một tác vụ, extension chụp trạng thái Git. Lúc agent dừng, nếu có thay đổi, Codex kiểm diff ở chế độ chỉ đọc. Kết quả `NEEDS_CHANGES` trả lại vấn đề cần sửa cho OMP tiếp tục; vòng lặp tối đa ba lượt. `PASS` hoặc `BLOCKED` hiện trên giao diện OMP. Subagent không kích hoạt vòng kiểm. Sau một lượt tiếp tục, `session_stop` tiếp theo vẫn được xử lý dù `stop_hook_active` là true.

Mỗi lượt có kết quả được ghi thành một dòng JSON trong `.agent-qc/reviews.jsonl` ở Git root. Thư mục này bị Git bỏ qua. Nếu không có thay đổi so với trạng thái ban đầu, không gọi Codex và không ghi kết quả. Để tự kiểm công cụ, chạy `npm run test:tooling` từ Git root.
