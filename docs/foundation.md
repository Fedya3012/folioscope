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
