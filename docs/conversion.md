# Chuyển đổi và OCR (Gói G)

Mở bằng nút **Chuyển đổi / OCR…** trên thanh công cụ, các ô "Chuyển đổi", "Tạo PDF", "OCR" ở Home, hoặc Bảng lệnh.

## Cách hoạt động

| Việc | Cách làm | Cần cài thêm |
|---|---|---|
| Ảnh sang PDF | Mã Rust, nhúng JPEG nguyên bản | Không |
| Word, Excel, PowerPoint, txt, HTML sang PDF | LibreOffice chạy ngầm | LibreOffice (tải khi cần, ~300 MB) |
| PDF/A-2b | LibreOffice, tuỳ chọn `SelectPdfVersion=2` | LibreOffice |
| PDF sang Word / PowerPoint | LibreOffice nhập PDF (`writer_pdf_import`, `impress_pdf_import`) | LibreOffice |
| PDF sang Excel | Tự gom ký tự thành dòng và ô theo vị trí, ghi `.xlsx` (`transform/xlsx.rs`) | Không |
| PDF sang PNG / JPEG | PDFium dựng từng trang vào thư mục `ten-file` | Không |
| PDF sang txt / HTML | Lấy chữ bằng PDFium | Không |
| OCR | Dựng trang 300 dpi, Tesseract tạo PDF có lớp chữ, ghép lại bằng lopdf | Tesseract (tải khi cần trên Windows) |

## Tesseract

- Tìm theo thứ tự: biến môi trường `FOLIOSCOPE_TESSERACT`, thư mục cài mặc định, `PATH`, bản app tự tải (`<dữ liệu app>/tesseract/app`).
- Windows: `src-tauri/src/ocr_install.rs` lấy bản phát hành mới nhất của UB Mannheim qua API GitHub, **chỉ cài khi API cung cấp mã SHA-256**, kiểm tra rồi chạy bộ cài `/S`. Nếu Windows đòi quyền quản trị (lỗi 740) thì chạy lại qua hộp xác nhận UAC.
- macOS và Linux: người dùng tự cài (`brew install tesseract`, `apt install tesseract-ocr`).
- Dữ liệu ngôn ngữ (`vie`, `eng`...) thiếu thì tải từ `tessdata_fast` vào `<dữ liệu app>/tesseract/tessdata` (kèm `pdf.ttf`).

## Giới hạn đã biết

- Chưa thử bản cài Tesseract và LibreOffice trên Windows thật (sandbox không tải được).
- OCR dựng lại cả trang thành ảnh JPEG 300 dpi, nên file kết quả có thể nặng hơn bản gốc và phần chữ đã có sẵn trong PDF cũng bị dựng lại thành ảnh.
- PDF sang Word/PowerPoint do LibreOffice nhập PDF nên trang phức tạp dễ lệch.
- PDF sang Excel đoán ô theo vị trí chữ, không đọc đường kẻ ô.
- Chưa có làm thẳng ảnh, khử nhiễu (OpenCV), ePub, PDF sang HTML giữ bố cục.
- PDF có mật khẩu: phải mở trong Folioscope và nhập mật khẩu trước khi chuyển.
