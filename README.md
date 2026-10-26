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
