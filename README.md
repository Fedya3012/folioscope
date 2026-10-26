# Folioscope

Ứng dụng PDF desktop đầy đủ tính năng (Tauri 2 + React + PDFium). Thiết kế UI/UX và kiến trúc nằm trong thread dự án.

## Chạy thử khi phát triển
```
npm ci
npm run fetch-pdfium     # tải thư viện PDFium cho máy bạn
npm run tauri dev
```
Kiểm thử: `npm test`, `cd src-tauri && cargo test`. Đặt `FOLIOSCOPE_TEST_PDF=/đường/dẫn/file.pdf` để chạy thêm bài thử vẽ trang với file thật.

## Lưu ý
- Không commit file PDF vào kho (đã chặn trong `.gitignore`); bộ file thử để ngoài kho.
- Giai đoạn 0 (hiện tại): khung app, hệ token, bố cục, mở và hiển thị PDF.

## Chế độ Trang (sắp xếp trang)

Bấm tab **Trang** (hoặc phím `O`) để xem lưới hình thu nhỏ: kéo thả đổi thứ tự, chọn nhiều trang (Ctrl/Shift/kéo khung), xoay (`R`, `Shift+R`), xoá (`Delete`), chèn trang trắng hoặc trang từ file khác, trích xuất, tách file, đảo thứ tự, hoàn tác (`Ctrl+Z`). Thay đổi chỉ được ghi khi bấm **Lưu thành…**; file gốc không bị sửa. Phần ghi file nằm ở `src-tauri/src/organizer.rs`.

## Gộp file (Combine)
- Nút **Gộp file…** trên thanh công cụ, hoặc chuột phải nhiều file trong Explorer → **Combine files in Folioscope...**
- PDF được ghép trực tiếp; ảnh (jpg, png, gif, bmp, tiff, webp) chuyển bằng mã Rust; Word, Excel, PowerPoint, OpenOffice, rtf, txt, csv, HTML chuyển bằng **LibreOffice** (cần cài trên máy, hoặc đặt `FOLIOSCOPE_SOFFICE` trỏ tới `soffice`).
- Mục chuột phải: trong hộp thoại bấm **Cài vào Explorer** (ghi vào HKCU, không cần quyền quản trị, gỡ được). Windows 11 hiện ở "Show more options" (Shift+F10); Explorer ẩn mục cổ điển khi chọn quá 15 file, khi đó kéo thả file vào cửa sổ.
- Thử gộp file thật: `FOLIOSCOPE_TEST_FILES="a.pdf|b.docx|c.jpg" cargo test combines_real_files_from_env` (thêm `FOLIOSCOPE_TEST_KEEP=/đường/dẫn/kq.pdf` để giữ kết quả).

## Trình xem: tiện dùng (gói B1)
- File PDF có mật khẩu: hộp nhập mật khẩu hiện khi mở; mật khẩu chỉ giữ trong bộ nhớ, không ghi ra đĩa (`pdf.rs`).
- Thanh điều khiển nổi ở góc dưới phải (trang trước/sau, zoom, chọn chữ, bàn tay), mờ đi sau 2 giây không đụng chuột.
- Nút ở thanh trạng thái đổi màu nền trang: giấy trắng, đọc ban đêm, sepia.
- Gộp file với PDF có mật khẩu vẫn chưa hỗ trợ: cần mở khoá trước.
## Home / Start Screen và Cài đặt
- Mở app không có file thì vào **Home**: lời chào, vùng kéo thả, 6 thao tác nhanh (Mở file, Tạo PDF, Gộp file đã chạy; Chuyển đổi, Nén, OCR ghi “Sắp có”), danh sách file gần đây (lưới/danh sách, ghim, xoá khỏi danh sách) và băng Templates (chưa có nội dung). Tab Home luôn ghim đầu thanh tab.
- Thả 1 file PDF vào cửa sổ thì mở; thả nhiều file hoặc Word/ảnh thì vào hộp thoại Gộp file. `Ctrl+O` mở file.
- **Cài đặt** (`Ctrl+,` hoặc nút bánh răng): chủ đề sáng/tối/theo hệ thống, màu nhấn, cỡ giao diện, mật độ, giảm chuyển động, zoom và bố cục mặc định, số file gần đây, mở lại file cuối khi khởi động. Danh sách file gần đây và cài đặt lưu ở localStorage của WebView.
