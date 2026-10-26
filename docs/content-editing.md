# Sửa nội dung PDF (Gói H)

Chế độ **Chỉnh sửa** cho sửa chữ, ảnh và hình vẽ có sẵn trong trang. Gói này chưa gồm: thêm hộp chữ/ảnh/hình mới, sửa liên kết, đường gióng thông minh, header/footer, watermark, Bates (mục 1.4 của bản kiểm kê vẫn còn).

## Cách hoạt động
- **Rust** (`src-tauri/src/content.rs`): PDFium coi nội dung trang là danh sách "đối tượng trang" (chữ, ảnh, đường/hình, nhóm). `list_page_objects` trả danh sách kèm khung theo tỉ lệ 0..1; mã đối tượng là số thứ tự trong trang **của file gốc**.
- Giao diện giữ một bản đồ sửa đổi `trang:mã -> ObjEdit` (`src/edit/model.ts`, `src/edit/store.ts`). Mỗi mục chỉ ghi phần khác bản gốc; mục nào hoá ra không đổi thì tự bỏ.
- **Xem trước**: `render_page_edited` mở lại file, áp sửa đổi của trang đó lên bản trong bộ nhớ rồi vẽ; file không bị đụng tới. Lệnh trả thêm khung đo lại của đối tượng (chữ đổi nội dung thì bề rộng đổi). `Viewer.tsx` dùng lệnh này khi trang có sửa đổi.
- **Lưu**: `save_content_edits` áp toàn bộ rồi ghi qua `fsutil` (file `.part`, đổi tên, giữ `.bak`). Cho phép ghi đè chính file gốc.

## Quy tắc áp sửa đổi
- Đổi nội dung (hoặc đậm/nhạt): chữ mới viết bằng phông hệ thống (Arial trên Windows/macOS, Liberation/DejaVu/Noto trên Linux) nhúng vào file, cùng cỡ, màu, vị trí đường đáy; chữ cũ bị xoá. Lý do: phông nhúng gốc thường là bản rút gọn, thiếu glyph cho chữ mới. Không tìm được phông nào thì dùng Helvetica và báo cho người dùng.
- Chỉ đổi cỡ hoặc màu chữ: giữ phông gốc.
- Ảnh: thay điểm ảnh giữ nguyên khung; di chuyển/đổi cỡ bằng ma trận biến đổi.
- Hình vẽ: màu tô, màu viền, độ dày nét, di chuyển, đổi cỡ.
- Xoá chạy sau cùng, từ chỉ số lớn xuống nhỏ, để mã các đối tượng còn lại không lệch.

## Hoàn tác
`appCommands.ts` đăng ký phạm vi `content-edit` (hoạt động khi ở chế độ Chỉnh sửa) nên Ctrl+Z và Ctrl+Shift+Z/Ctrl+Y hoạt động như các chế độ khác. Mỗi lần sửa một đối tượng là một bước; kéo thả là một bước (ghi lúc thả chuột). Lịch sử, bản đồ sửa đổi và "chưa lưu" được cất/nạp theo từng tab (`capture`/`restore` trong `store.ts`).

## Giới hạn đã biết
- Một đối tượng chữ của PDFium thường là một dòng hoặc một cụm trong dòng, nên câu dài có thể gồm vài đối tượng; sửa từng đối tượng một.
- Trang đang xoay chưa sửa được (báo lỗi, cần xoay về 0° ở chế độ Trang).
- Chữ đã sửa nằm trên cùng lớp (có thể che ảnh/hình nằm đè lên chỗ cũ).
- Chữ trong ảnh quét không sửa được (cần OCR, Gói G).
- Chưa thử bằng tay trên Windows thật.
