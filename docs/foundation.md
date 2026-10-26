# Nền dùng chung (Gói A): cách dùng cho các gói sau

## Lưu trữ (SQLite)
- File `folioscope.sqlite` nằm trong thư mục dữ liệu app của hệ điều hành. Bảng `kv(key, value, updated_at)`; cấu trúc nâng cấp qua `MIGRATIONS` trong `src-tauri/src/db.rs`.
- Giao diện dùng `db` từ `src/lib/db.ts`: `db.getJson(key)` đọc đồng bộ (đã nạp vào bộ nhớ lúc khởi động), `db.setJson(key, value)` ghi nền.
- Chạy ngoài app (trình duyệt, test) thì tự dùng localStorage. Dữ liệu bản cũ trong localStorage được chuyển sang SQLite ở lần chạy đầu.
- Khoá mới nên đặt tên `folioscope.<tính-năng>`.

## Lưu file an toàn
`src-tauri/src/fsutil.rs`: ghi ra `<tên>.part` cạnh đích rồi `commit_tmp(tmp, out, true)` để đổi tên; nếu đích đã có thì giữ 1 bản `<tên>.bak`. Ghi chú, xuất trang và Gộp file đều dùng.

## Toast
`toast.success("…")`, `toast.error("…")`, có thể kèm nút: `toast.success("Đã xoá 2 trang", { label: "Hoàn tác", run })`. Tối đa 3 toast; tự đóng 4 giây (6 giây có nút, lỗi 9 giây); rê chuột thì dừng đếm.

## Phím tắt
Đăng ký bằng `registerCommands([...])` (`src/lib/shortcuts.ts`), trả hàm gỡ. Lệnh toàn app nằm ở `src/appCommands.ts`; màn hình nào có phím riêng thì đăng ký khi mở, gỡ khi đóng. `Mod` = Ctrl hoặc ⌘. Mặc định lệnh không chạy khi đang gõ vào ô nhập hoặc hộp thoại (`typing: "allow"` để cho phép). `run` trả `false` nghĩa là "không xử lý", phím chuyển cho lệnh khớp tiếp theo. `listCommands()` là nguồn cho Command Palette và bảng phím tắt sau này.

## Hoàn tác/Làm lại toàn cục
`src/lib/undo.ts`. Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y gọi `undo()` / `redo()`.
- Tính năng đã có lịch sử riêng: `registerUndoScope({ active, canUndo, canRedo, undo, redo })` (Trang và Ghi chú đã đăng ký, theo chế độ đang mở).
- Tính năng mới: sau mỗi thao tác gọi `pushUndo({ label, undo, redo })`. Ngăn xếp chung chỉ nhận phím khi không có phạm vi nào đang hoạt động.

## Cài đặt mở rộng, phím tắt tuỳ chỉnh, Bảng lệnh (Gói D)
- Cài đặt có thêm nhóm Chỉnh sửa, OCR, AI (các giá trị đã lưu trong `Settings`, nhưng chức năng tương ứng sẽ đọc chúng ở các gói sau), Phím tắt, Tài khoản (ghi "Sắp có").
- Phím tuỳ chỉnh lưu ở khoá `folioscope.keymap` ({ idLệnh: [phím] }). `src/lib/keymap.ts` đọc/ghi, `shortcuts.ts` giữ bộ ghi đè nên `registerCommands` luôn dùng phím đã đổi; `listCommands()` trả phím đang có hiệu lực. Lệnh mới chỉ cần đăng ký như cũ là tự xuất hiện trong bảng Phím tắt và Bảng lệnh.
- Bảng lệnh (Ctrl+Shift+P): `src/components/CommandPalette.tsx`, tìm mờ không cần dấu (`src/lib/palette.ts`). Lệnh có `when` trả false thì không hiện.
## Nhiều tab tài liệu (Gói C)
- `useStore.tabs` là danh sách đường dẫn các tài liệu đang mở; `path` là tab đang chọn, Home luôn ghim đầu và không nằm trong `tabs`. Mở file đã có tab thì chỉ chuyển sang tab đó.
- Mỗi tab có trạng thái riêng (trang, zoom, kiểu xem, chế độ, mục lục, ghi chú, danh sách trang). Khi rời tab, `capture()` trong `src/store.ts` cất trạng thái đó cùng với `useAnnot` và `useOrganizer`; khi quay lại, `restore()` nạp lại. Tính năng mới có state theo tài liệu cần được thêm vào hai hàm này.
- `isDirty(path)` cho biết tab có thay đổi chưa lưu (hiện chấm trên tab và hỏi trước khi đóng). Tính năng mới có thay đổi chưa lưu nên đưa vào đây.
- Vị trí đọc lần cuối của từng file (trang, zoom, kiểu xem) lưu ở khoá `folioscope.positions`, tối đa 200 file.
- Phím tắt: `Ctrl+W` đóng tab, `Ctrl+Tab` / `Ctrl+Shift+Tab` chuyển tab.

## Ghi chú (Gói F)
- `src/annotations/snap.ts`: kéo chuột trên chữ → các hình chữ nhật bám từng dòng (dùng `getTextRuns` của Viewer, không sửa Viewer). Trang ảnh quét không có lớp chữ thì dùng khung tự do.
- `src/annotations/measure.ts`: đo khoảng cách, chu vi, diện tích theo kích thước trang (điểm PDF) và tỉ lệ (`folioscope.measureScale`).
- `src/annotations/export.ts`: đổi chú thích trong app thành danh sách phẳng cho Rust (`save_annotations`): đánh dấu nhiều dòng, bình luận kèm trả lời, tem, số đo. Phía Rust không đổi.
- Bảng phải `AnnotationPanel.tsx`: thuộc tính đối tượng đang chọn, bình luận và trả lời, danh sách bình luận. Phím công cụ (H, U, S, N, T, R, E, L, A, P, K, D, M, G) đăng ký qua `registerCommands` khi ở chế độ Ghi chú; mọi sửa đổi đi qua `commit` nên Ctrl+Z hoàn tác được.
- Giới hạn: PDF chuẩn lưu trả lời bình luận gộp trong nội dung ghi chú (chưa có liên kết cha–con IRT); tem là khung + chữ chứ chưa phải tem ảnh.
