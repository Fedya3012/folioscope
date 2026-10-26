# So sánh PDF và Trợ lý AI (Gói I)

## So sánh hai bản
Mở bằng nút **So sánh…** trên thanh công cụ, hoặc Bảng lệnh ("So sánh hai bản PDF…").
- Chọn **Bản cũ** và **Bản mới** (bản cũ mặc định là file đang mở). Hai trang cùng số thứ tự được so với nhau.
- **Theo chữ**: chữ lấy bằng PDFium (`get_doc_text`), so từng từ (`src/lib/compare.ts`, LCS). Đỏ gạch ngang = bị xoá/sửa, xanh = mới thêm. Khoảng trắng và xuống dòng khác nhau không tính.
- **Theo hình**: dựng cả hai trang rộng 720 px, so từng điểm ảnh (ngưỡng 48/255 để bỏ nhiễu nén), tô đỏ chỗ khác và hiện % diện tích khác.
- Hai cột cuộn đồng bộ; nút "Chỗ khác trước/sau" nhảy tới trang có thay đổi.
- File có mật khẩu: mở trong Folioscope nhập mật khẩu trước (mật khẩu đã nhập được nhớ trong bộ nhớ).
- Chưa làm: ghép trang theo nội dung khi bản mới chèn/xoá nguyên trang (hiện ghép theo số thứ tự), so sánh bản quét không có chữ bằng OCR.

## Trợ lý AI (qua mạng)
- Chỉ có một nhà cung cấp: **Anthropic** (Messages API). Thêm nhà cung cấp khác cần hỏi người dùng trước.
- **Khoá API** dán trong Cài đặt → AI Assistant. Windows: Credential Manager; macOS: Keychain (crate `keyring`). Linux (chỉ để dev/CI): file `ai/api-key` quyền 0600 trong thư mục dữ liệu app. Khoá không nằm trong cài đặt/SQLite và không bao giờ trả về giao diện; gọi mạng chạy ở Rust (`src-tauri/src/ai.rs`).
- Mở bảng **Trợ lý AI** (nút trên thanh công cụ, `Ctrl+Shift+A`). Việc: Hỏi đáp (có nguồn `[tr. N]` bấm để nhảy trang), Tóm tắt, Dịch, Viết lại, Trích bảng; phạm vi "Cả tài liệu" hoặc "Trang đang xem".
- Gửi đi tối đa khoảng 150 000 ký tự mỗi lần. Bật "Không gửi nội dung nhạy cảm" thì email, số thẻ, CMND/CCCD bị che trước khi gửi (`redactSensitive`).
- Lịch sử hỏi đáp lưu theo từng file trong SQLite nếu bật "Lưu lịch sử hỏi đáp" (không có khoá).
- Bản quét không có chữ: cần chạy OCR trước.
- Chưa làm: trả lời từng chữ một (streaming), nút "Hỏi AI/Dịch" trong thanh nổi khi chọn chữ, đề xuất mục lục bằng AI, nhà cung cấp thứ hai.
