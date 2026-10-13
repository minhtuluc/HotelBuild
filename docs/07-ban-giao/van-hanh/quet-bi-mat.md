# HB-176 — quét bí mật trong lịch sử Git

**Phần đã hiện thực:** job `gitleaks` trên mọi PR, push main và chạy tay. Đây là phần độc lập của HB-176; **toàn ticket còn OPEN** vì HB-175 chưa có staging/hosting, chưa cấp kho bí mật thực và chưa chốt quy trình xoay JWT/PSP. Không có giá trị bí mật hoặc tên tài khoản môi trường trong tài liệu này. Job không triển khai, xoay khoá, gửi bình luận hoặc tải báo cáo chứa nội dung lên dịch vụ khác.

## Cách chạy

Dùng Linux x64, Bash, Git, curl, tar, sha256sum và Node 22:

```sh
bash infra/security/install-gitleaks.sh /tmp/hb176-bin
export GITLEAKS_BIN=/tmp/hb176-bin/gitleaks
node --test infra/security/scan-git-secrets.test.mjs
bash infra/security/scan-git-secrets.sh
```

Installer ghim Gitleaks **8.30.1**, xác minh SHA-256 trước giải nén/chạy; sai checksum hoặc tải lỗi đều thất bại. Nguồn: [release chính thức](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1). Checkout/setup-node ghim commit; checkout toàn lịch sử và không lưu token GitHub vào Git config. Job chỉ có `contents: read`, không cần licence hoặc secret từ fork.

Scanner đọc **toàn lịch sử HEAD**, gồm commit merge của PR, với bộ luật mặc định của bản đã ghim. Không chỉ quét diff mới. Không bỏ qua cả test/thư mục/luật; không đổi mã thoát phát hiện thành thành công. CLI luôn bật che 100%, không bật verbose và không xuất/upload báo cáo. Lỗi công cụ và phát hiện bí mật đều làm bước thất bại. Đây là kiểm tra mẫu/entropy, không phải chứng minh tuyệt đối repo không thể có bí mật.

Cấu hình và danh sách ngoại lệ nằm trong `.github/workflows/gitleaks-defaults.toml` và `.github/workflows/gitleaks-history.ignore`, thuộc hàng rào file bảo vệ; HB-176 được `unlock` đúng phạm vi này. CLI nhận hai đường dẫn tường minh, không nhận cấu hình tự do từ repo đích. Lịch sử dùng `--full-history --diff-merges=first-parent HEAD`: diff commit merge so với parent đầu nhưng vẫn duyệt các parent còn lại; bắt cả credential chỉ thêm khi giải quyết merge rồi xoá ở commit sau. Tắt external diff/textconv. Gitleaks 8.30.1 vẫn cộng thêm `source/.gitleaksignore` dù truyền đường dẫn riêng: helper **từ chối** file/symlink đó, không xoá hay sửa nó. Cấu hình `.gitleaks.toml` tại nguồn và chú thích `gitleaks:allow` không tắt được kiểm tra.

## 11 báo giả đã phân loại

Ngoại lệ chỉ ghim `commit:path:rule:line` do scanner sinh. Nội dung không được chép vào tài liệu. Commit mới có cùng đường dẫn/dòng hoặc cùng chuỗi vẫn bị kiểm tra; không dùng baseline JSON rộng hay regex để miễn trừ giá trị.

| Nguồn lịch sử | Số | Lý do |
| --- | ---: | --- |
| settings-api, payment-fixtures, payment-journey, journey-fixtures | 4 | UUID khoá chống trùng trong fixture tổng hợp; không phải credential |
| web-session/client | 2 | Token mô phỏng từ fetch test, không phải JWT phiên thật |
| audit-writer.locked | 1 | Khoá setting tổng hợp của oracle kiểm rollback khi ghi audit thất bại; giữ nguyên bytes test khoá |
| ci.yml | 2 | Mật khẩu PostgreSQL tạm của container CI loopback, không phải tài khoản staging/production |
| api-client/reauth-deadlock | 1 | Chuỗi mật khẩu của fetch fixture, không gọi dịch vụ xác thực thật |
| api.md | 1 | Ví dụ PIN token trong tài liệu giao thức, không có backend phát hành tương ứng |

Bản kiểm thử dùng scanner thật và Git repo tạm chứng minh: lịch sử sạch qua; khoá fixture mới giống dạng ngoại lệ vẫn bị chặn; credential tổng hợp mới bị chặn dù thêm cấu hình/ignore/chú thích nhằm bỏ qua; stdout/stderr không chứa giá trị; archive sai checksum không được giải nén/chạy; archive đúng chạy được bản đã ghim. Repo tạm được xoá trong `finally`.

## Khi kiểm tra thất bại

Không thêm ngoại lệ chỉ để làm xanh. Xác minh riêng giá trị là fixture hay credential thật; không dán giá trị vào PR/log. Credential thật phải thu hồi/xoay ở bên cấp và báo chủ dự án; việc xoá file hiện tại không xoá lịch sử. Không tự force-push/viết lại main. Báo giả mới cần review và fingerprint commit chính xác trong file bảo vệ; không miễn trừ cả thư mục hay toàn bộ test.

Khi nâng phiên bản, cập nhật checksum từ release chính thức, chạy lại hồi quy và toàn lịch sử; giữ bằng chứng phát hiện mới. Các luật mặc định có ngoại lệ định dạng/vendor của upstream; không coi scanner là kiểm thử PII/runtime hoặc thay cho pentest HB-183.

## Chưa nghiệm thu

- Không có staging HB-175, bảng biến × môi trường/kho thực và lịch xoay JWT/PSP đã duyệt: HB-176 còn OPEN.
- Job được thêm vào repo không tự đổi branch protection. Cần job GitHub chạy trên đúng SHA và trạng thái bắt buộc do chủ repo quản trị; thiếu run/check phải ghi BLOCKED, không gọi CI hosted xanh.
- Các việc CodeQL/Trivy/pnpm audit, hạn xử lý CVSS và pentest staging thuộc HB-183, chưa được thực hiện bởi phần này.
