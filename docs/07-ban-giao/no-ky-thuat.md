# Nợ kỹ thuật

Theo [QĐ-04](../05-ke-hoach/nhat-ky/QD-04-quan-tri-tu-chu.md) mục 7: những gì chưa làm kịp mà **không** chạm tiền, tồn, phân quyền, bảo mật thì ghi vào đây thay vì dừng việc. Người làm thêm dòng trong PR của mình; lead xếp ưu tiên. Mục nào thuộc [cổng go-live](../08-thi-cong/lo-trinh-den-deploy.md#4-cổng-go-live) phải trả trước go-live.

| Mã | Mô tả | Ghi bởi (ticket/PR) | Ảnh hưởng | Trả trước | Trạng thái |
|---|---|---|---|---|---|
| TD-01 | Worker chưa gắn listener `error` cho BullMQ: Redis chết thì im lặng, không log | HB-006 (#12) | Khó chẩn đoán sự cố | Ticket worker nghiệp vụ đầu tiên (HB-078) | Mở |
| TD-02 | Smoke 2 app Android trên thiết bị/emulator chưa chạy | F0, HB-022, HB-024 | Chưa có bằng chứng chạy trên máy thật | Go-live (cổng 13) | Mở |
| TD-03 | Phân mảnh `audit_logs` theo tháng chưa làm | csdl §8.1 | Hiệu năng khi > 20 triệu dòng | Khi chạm ngưỡng | Mở |
