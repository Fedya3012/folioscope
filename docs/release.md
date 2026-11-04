# Phát hành và tự cập nhật (gói J)

## Cách app tự cập nhật
- App hỏi `https://github.com/Fedya3012/folioscope/releases/latest/download/latest.json` (file này do workflow **Release** đăng kèm mỗi bản phát hành).
- Mỗi lần mở app (nếu bật **Cài đặt → Chung → Tự kiểm tra bản mới**) hiện một thông báo nhỏ khi có bản mới; **không tự cài**. Cũng có nút **Kiểm tra bản mới** trong cùng mục.
- Bấm **Cài và mở lại**: app tải gói, kiểm tra chữ ký bằng khoá công khai trong `tauri.conf.json`, cài ở chế độ yên lặng rồi mở lại. File và cài đặt của bạn không bị đụng tới.
- Bộ cài Windows (NSIS `.exe`) cài theo người dùng hiện tại, **không cần quyền quản trị**; có thêm bản `.msi`.

## Phát hành một bản mới
1. Sửa `version` trong `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` và `package.json` cho cùng một số (ví dụ `0.2.0`), merge vào `main`.
2. Vào GitHub → **Actions → Release → Run workflow**, nhập tag `v0.2.0`. (Hoặc đẩy tag `v0.2.0`.)
3. Chờ xong, bản mới nằm ở trang **Releases**; máy đã cài Folioscope sẽ thấy thông báo.

## Cần cung cấp một lần (Settings → Secrets and variables → Actions → New repository secret)
| Secret | Dùng để | Bắt buộc |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | ký gói cập nhật (khoá riêng do chủ dự án tạo trên máy mình; khoá công khai tương ứng nằm trong `tauri.conf.json`) | có |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | mật khẩu khoá trên; để trống nếu lúc tạo khoá không đặt mật khẩu | không |
| `WINDOWS_CERTIFICATE` | chứng chỉ ký số Windows (`.pfx`) mã hoá base64 | không (xem dưới) |
| `WINDOWS_CERTIFICATE_PASSWORD` | mật khẩu của file `.pfx` | cùng với trên |

Mất khoá riêng `TAURI_SIGNING_PRIVATE_KEY` thì không phát hành được bản cập nhật cho máy đã cài: hãy giữ một bản sao an toàn.

## Ký số Windows (code signing)
Ký số làm Windows SmartScreen bớt cảnh báo "nhà phát hành không xác định". **Không bắt buộc để app chạy hay tự cập nhật**; chưa có chứng chỉ thì bộ cài vẫn ra, chỉ chưa ký.
Khi có chứng chỉ `.pfx` (mua từ nhà cấp như DigiCert, Sectigo, SSL.com…):
1. Đổi sang base64: PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard`
2. Dán vào secret `WINDOWS_CERTIFICATE`, mật khẩu vào `WINDOWS_CERTIFICATE_PASSWORD`.
3. Lần Release kế tiếp, bước "Ký số Windows" tự nhập chứng chỉ và Tauri ký cả `.exe` lẫn `.msi` (dấu thời gian DigiCert).

Nhiều nhà cấp hiện chỉ bán chứng chỉ dạng khoá trên phần cứng hoặc dịch vụ ký trên cloud (Azure Trusted Signing, SSL.com eSigner…); loại đó không có file `.pfx`. Khi đó cần đổi bước ký sang `bundle.windows.signCommand` của Tauri theo hướng dẫn của nhà cấp.
macOS chưa ký/notarize (cần tài khoản Apple Developer); không ảnh hưởng bản Windows.

Ghi chú kỹ thuật: gói cập nhật (`.sig`, `latest.json`) chỉ được tạo khi build phát hành, qua `src-tauri/tauri.release.conf.json`; CI thường không cần khoá ký.

## Menu chuột phải trên Windows 11 (menu chính)
- Mục cổ điển (`Show more options`) do app tự đăng ký vào HKCU, không cần quyền quản trị (`src-tauri/src/shell_menu.rs`).
- Để mục hiện ngay ở menu chính, Windows 11 bắt buộc dùng thành phần COM `IExplorerCommand` thuộc một gói có danh tính. `scripts/build-shellext.ps1` (chạy trong CI trên Windows) dựng DLL (`src-tauri/shellext`), đóng gói "thưa" `AppxManifest.xml`, ký bằng **chứng chỉ tự ký** tạo mới mỗi lần build và đưa chung vào bộ cài (`src-tauri/winshell/`).
- Người dùng bật ở **Cài đặt → Chung → Hiện ở menu chính của Windows 11**. Lần đầu Windows hỏi quyền quản trị để tin chứng chỉ (`Trusted People`); mỗi bản mới có chứng chỉ mới nên sẽ hỏi lại khi bật lại. Gỡ app hoặc tắt công tắc sẽ gỡ gói.
- Muốn bỏ bước hỏi quyền: ký bằng chứng chỉ thật (Azure Trusted Signing hoặc chứng chỉ OV/EV) thay cho chứng chỉ tự ký trong script.
- Không thử được trên Linux: kiểm tra trên Windows 11 thật sau khi tải bộ cài từ CI.
