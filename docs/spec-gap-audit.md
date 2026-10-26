# Folioscope: rà soát khoảng cách giữa bản thiết kế và bản đã build

Ngày rà soát: 26/10/2026. Đối chiếu với nhánh `main` (sau PR #7).

Nguồn đối chiếu:
- Bản thiết kế UI/UX: https://claude.ai/artifact/LR7CnPGGroFZdncppcmpC7 (viết tắt **UI**, số mục theo bản thiết kế)
- Bản kiến trúc và lộ trình: https://claude.ai/artifact/V6zByDHCWJLPXpof2wMGvX (viết tắt **KT**)
- Kế hoạch chuẩn bị: `ke-hoach-chuan-bi-xay-dung.md`

Tài liệu này chỉ rà soát và lập kế hoạch, không có thay đổi mã.

**Cỡ việc (ước lượng thô, một người làm cùng Claude):** S = dưới 3 ngày, M = 3 ngày đến 2 tuần, L = trên 2 tuần.

**Cách xác định "đã có":** đọc mã trong `src/` và `src-tauri/src/`, đối chiếu với README và lịch sử commit. Chưa chạy thử trên máy thật, nên "đã có" nghĩa là mã tồn tại và có test, không đảm bảo mọi chi tiết thị giác khớp thiết kế.

---

## Tóm tắt nhanh

| Nhóm | Số mục |
|---|---|
| 1. Chưa làm | 38 |
| 2. Làm một phần | 14 |
| 3. Cố ý gỡ hoặc hoãn | 3 nhóm lớn (Form, Chữ ký và Bảo mật, Bảo vệ) |
| 4. Đã làm và khớp thiết kế | 17 |

Theo lộ trình KT: Giai đoạn 0 xong, Giai đoạn 1 làm được khoảng một nửa, Giai đoạn 2 xong phần lớn (còn thiếu macOS/Linux và vài tuỳ chọn), Giai đoạn 3 làm được phần cốt lõi, Giai đoạn 4 đến 7 chưa bắt đầu.

---

## 3. Cố ý gỡ hoặc hoãn

Bạn đã quyết định hoãn ba nhóm này vào ngày 26/10/2026 và sẽ thêm lại sau khi app xong. Thiết kế đã có sẵn trong UI (mục "Tính năng hoãn lại"), kiến trúc đã chừa chỗ (module `forms`, `sign`, `security`), ước lượng 6 đến 8 tuần. Danh sách này **không** tính vào các mục "chưa làm".

| Nhóm | Gồm | Spec | Ghi chú | Cỡ |
|---|---|---|---|---|
| Form | Nhận diện và tạo trường, điền, tính toán, xuất dữ liệu; chế độ Form; ô "Tạo form" ở Home | UI "Tính năng hoãn lại"; KT mục 10 | Hoãn theo yêu cầu | L |
| Chữ ký và Bảo mật | Ký tay/gõ/ảnh, chữ ký số PAdES, chứng thư, dấu thời gian, gửi ký, "Cần ký" ở Home, nhóm Settings | UI "Tính năng hoãn lại"; KT mục 10 | Hoãn theo yêu cầu | L |
| Bảo vệ (Protect) | Mật khẩu, AES-256, quyền hạn, redact thật sự, xoá metadata, chứng nhận | UI "Tính năng hoãn lại"; KT mục 10 | Hoãn theo yêu cầu | L |

Lưu ý còn nợ từ thiết kế: **mở file PDF có mật khẩu** vẫn phải hoạt động ngay từ đầu (UI và KT đều nói rõ). Hiện chưa có, xem mục 1.

---

## 4. Đã làm và khớp thiết kế

| # | Hạng mục | Spec | Ghi chú |
|---|---|---|---|
| 4.1 | Khung Tauri 2 + React + TypeScript + Vite + Zustand | KT 1, GĐ0 | Đúng bộ công nghệ đã chọn |
| 4.2 | CI build và test trên Windows, macOS, Linux; xuất file cài | KT 9, GĐ0 | `.github/workflows/ci.yml`, có `vitest`, `tsc`, `cargo test`, `tauri build` |
| 4.3 | Design tokens và Dark/Light | UI 2, KT GĐ0 | `src/styles/tokens.css`; nút đổi giao diện, nhớ lựa chọn |
| 4.4 | Bố cục: title bar, toolbar, rail, panel trái/phải, canvas, status bar | UI 1 | Panel kéo đổi cỡ, snap thu gọn, `Ctrl+\` và `Ctrl+Shift+\` |
| 4.5 | Render trang bằng PDFium | KT 1, GĐ1 | `pdf.rs`, thư viện tải bằng `npm run fetch-pdfium` |
| 4.6 | Zoom, vừa trang, vừa bề rộng, phím `Ctrl+0/1/2/+/-` | UI 4B | Khớp bảng tương tác |
| 4.7 | Chế độ cuộn liên tục và từng trang | UI 4B | Hai chế độ này khớp; các chế độ khác xem mục 1 |
| 4.8 | Công cụ Bàn tay và Chọn chữ | UI 4B | Có lớp chữ (`get_text_runs`) |
| 4.9 | Hình thu nhỏ, Mục lục (bookmark), Tìm kiếm trong file | UI 4B | Rail có 3 tab; tìm kiếm có phân biệt hoa thường, nhảy tới kết quả |
| 4.10 | Ô nhập số trang, nút trang trước/sau, phím `PgUp/PgDn/Home/End` | UI 1 (status bar) | |
| 4.11 | Chế độ Ghi chú: tô sáng, gạch chân, gạch ngang, ghi chú, hộp văn bản, chữ nhật, elip, đường, mũi tên, vẽ tay | UI 4C, KT GĐ3 | 6 màu, Hoàn tác/Làm lại, lưu thành bản sao có ghi chú (xem 2.4 về giới hạn) |
| 4.12 | Page Organizer: lưới, kéo thả, chọn nhiều (Ctrl/Shift/kéo khung), xoay, xoá, chèn trang trắng và từ file khác, trích xuất, tách file, đảo thứ tự, Hoàn tác | UI 4D, KT GĐ2 | `Organizer.tsx`, `organizer.rs`; phím `O`, `R`, `Delete`, `Ctrl+Z/Y`; thanh trượt cỡ thumbnail; toast Hoàn tác |
| 4.13 | Gộp file: PDF, ảnh (Rust), Office/txt/HTML (LibreOffice), thứ tự kéo đổi, dấu trang theo tên file, hủy giữa chừng, tiến trình | UI 4G, KT 4.2 | `combine/`; LibreOffice phải cài sẵn trên máy (xem 2.7) |
| 4.14 | Nén kết quả khi gộp: Không / Cân bằng / Tối đa | UI 4G | `combine/optimize.rs` |
| 4.15 | Menu chuột phải Windows "Combine files in Folioscope..." | UI 4G, KT GĐ2 | `shell_menu.rs` ghi vào HKCU; hiện ở "Show more options" trên Windows 11 |
| 4.16 | Chạy một bản duy nhất, nhận file từ lần bấm chuột phải | UI 4G | `tauri-plugin-single-instance`, `launch.rs` |
| 4.17 | Test tự động cho logic cốt lõi | KT 9 | Vitest cho viewer, layout, organizer, combine, hình học ghi chú; Rust test cho combine, annotations |

---

## 2. Làm một phần

| # | Hạng mục | Spec | Đã có | Còn thiếu | Cỡ |
|---|---|---|---|---|---|
| 2.1 | Thanh công cụ chính và Mode switcher | UI 1 ② | Có 5 chế độ: Xem, Ghi chú, Chỉnh sửa, Trang, Tất cả công cụ | Chế độ **Chỉnh sửa** và **Tất cả công cụ** chỉ là nút, chưa có nội dung; thiếu Chia sẻ, Lưu, nút AI, Undo/Redo toàn cục, phím tắt `1`-`8` đổi chế độ | M |
| 2.2 | Tab tài liệu | UI 1 ① | Hiện tên file đang mở | Chỉ một tài liệu cùng lúc; thiếu nhiều tab, nút "+", kéo tách cửa sổ, chấm "chưa lưu", tab Home | M |
| 2.3 | Rail điều hướng | UI 1 ③ | Hình thu nhỏ, Mục lục, Tìm kiếm | Thiếu Comments, Attachments, Layers, Lịch sử phiên bản (Chữ ký thuộc phần hoãn) | S |
| 2.4 | Ghi chú: lưu và công cụ | UI 4C, KT GĐ3 | 10 công cụ, lưu ra bản sao | Chưa lưu đè file gốc; chưa có bảng màu 8 màu và chọn màu tự do; thiếu Sticky note dạng comment, Callout, Tem, Đo đạc, Đính kèm file, Ghi âm; **chưa có comment có trả lời, tác giả, trạng thái Mở/Đã xử lý** | L |
| 2.5 | Tìm kiếm | UI 4B | Tìm trong file đang mở, nhảy tới kết quả | Chưa có vạch đánh dấu kết quả trên thanh cuộn; chưa có tìm trong cả thư mục (SQLite FTS5) | M |
| 2.6 | Panel phải "Thuộc tính" | UI 1 ⑥, 4C | Panel mở/đóng được, kéo đổi cỡ | Nội dung đang là dòng chữ giữ chỗ; chưa có thuộc tính đối tượng, chi tiết comment | M |
| 2.7 | Gộp file: tuỳ chọn và Office | UI 4G, KT 4.2 | Đã làm (Gói E): giữ dấu trang gốc, chuẩn hoá A4, mật khẩu trong hàng, "Mở trong Page Organizer", tải LibreOffice khi cần (~300 MB, hỏi trước; chưa thử trên Windows thật) | Còn thiếu: "OCR file ảnh" (Gói G), cảnh báo font; dấu trang của file khoá mật khẩu không giữ được | S |
| 2.8 | Menu chuột phải | UI 4G | Chỉ mục "Combine files..." trên Windows | Thiếu "Convert to PDF", "Open with", "Compress/Split"; thiếu menu con "Folioscope ▸"; chưa có bản MSIX cho menu Windows 11 gốc; macOS (Finder Sync + Quick Action) và Linux chưa có | L |
| 2.9 | Page Organizer: phần còn thiếu | UI 4D | Đã làm (Gói E): Thay thế trang, Cắt lề, Đánh số trang, nút "+" giữa trang, chèn từ clipboard/ảnh, tách theo dấu trang hoặc dung lượng, kéo file từ Explorer vào lưới | Còn thiếu: chèn từ máy quét, hiệu ứng chuyển cảnh chia sẻ | S |
| 2.10 | Trạng thái và phản hồi | UI 5, 6 | Có toast ở Organizer, thanh tiến trình ở hộp Gộp file | Chưa có hệ toast dùng chung, tiến trình nền ở status bar, hệ component chuẩn (tooltip, menu, popover, ...) | M |
| 2.11 | Phím tắt | UI 1, 4B, 8 | Một số phím (zoom, panel, `O`, Organizer, công cụ ghi chú) | Thiếu `F4`, `F11`/Focus mode, `Ctrl+K`, `F6` nhảy vùng, `Ctrl+/` bảng phím tắt, `Ctrl+[`, `Ctrl+]`; chưa tuỳ biến được | M |
| 2.12 | Hiệu năng và bộ nhớ đệm | KT 6 | Thumbnail, render theo trang | Render theo ô (tile), cache RAM + đĩa có giới hạn, ảnh độ phân giải thấp rồi thay nét; chưa có số đo so mục tiêu (mở 500 trang dưới 1 giây) | M |
| 2.13 | Truy cập (a11y) | UI 8 | Nhiều nút có `aria-label`, `role` đúng | Chưa kiểm axe tự động, chưa có chế độ tương phản cao, F6, roving tabindex, kiểm VoiceOver/NVDA | M |
| 2.14 | Đóng gói | KT 8 | CI xuất `.msi`, `.exe`, `.dmg`, `.deb`, `.AppImage` | Chưa có ký số, bộ cập nhật tự động, kênh Beta, MSIX | M |

---

## 1. Chưa làm

### 1A. Màn hình và chế độ chính

| # | Hạng mục | Spec | Ghi chú | Cỡ |
|---|---|---|---|---|
| 1.1 | **Màn hình Home** (lời chào, kéo thả, hành động nhanh, file gần đây, ghim, mẫu) | UI 4A | Hiện chỉ có màn "Mở file PDF đầu tiên"; thiếu cả thumbnail file gần đây (cần SQLite) | L |
| 1.2 | **Chế độ Chỉnh sửa nội dung**: sửa chữ, hộp chữ, ảnh, hình, link | UI 4C, KT 4.1, GĐ5 | Phần khó nhất của dự án; cần module riêng trên lopdf + `rustybuzz` | L |
| 1.3 | Thanh nổi và bảng Thuộc tính khi chỉnh sửa (font, cỡ, B/I/U, tay nắm, smart guides, scrub số) | UI 4C | Đi cùng 1.2 | L |
| 1.4 | Header/footer, watermark, nền trang, đánh số Bates | UI 4C, KT GĐ5 | | M |
| 1.5 | **Màn hình Convert / Create** (Sang PDF, Từ PDF, Nén, OCR; 2 cột; tiến trình) | UI 4E, KT GĐ4 | Hiện chỉ có Gộp file; nén chưa dùng được riêng lẻ | L |
| 1.6 | PDF sang Word, Excel, PowerPoint, ảnh, HTML, text, ePub | UI 4E, KT 4.3 | Có nút "Xem trước" trước khi lưu | L |
| 1.7 | PDF/A | UI 4E, KT GĐ4 | | M |
| 1.8 | Tạo PDF từ máy quét, ảnh chụp màn hình, trang web, clipboard, template | UI 4E | | M |
| 1.9 | **OCR và Scan** (tiếng Việt, Anh; làm thẳng, khử nhiễu; sửa từ nghi ngờ) | UI "OCR và Scan", KT GĐ4 | Tesseract 5 + OpenCV | L |
| 1.10 | **So sánh hai bản** (theo chữ và theo hình, cuộn đồng bộ) | UI "So sánh", KT 4.4 | | L |
| 1.11 | **Trợ lý AI** (tóm tắt, hỏi đáp có trích trang, dịch, viết lại, trích bảng) | UI "AI Assistant", KT 4.5 | Chế độ qua mạng đã chọn; cần nơi lưu khoá API trong kho khoá hệ điều hành | L |
| 1.12 | **Command Palette** (`Ctrl+K`) | UI "Command Palette" | Cần danh sách lệnh chung trước | M |
| 1.13 | **Settings / Preferences** (cửa sổ riêng, tìm kiếm, các nhóm) | UI 4F | Hiện chỉ có nút Sáng/Tối | L |
| 1.14 | In (xem trước, tập sách, nhiều trang/tờ) | UI "Print", KT GĐ1 | | M |
| 1.15 | Accessibility Checker cho PDF (tag, alt text, thứ tự đọc) | UI "Print & Accessibility Check" | | M |
| 1.16 | Đọc to (Text-to-speech) | UI 4B, 8 | | M |

### 1B. Trình xem PDF

| # | Hạng mục | Spec | Ghi chú | Cỡ |
|---|---|---|---|---|
| 1.17 | **Mở file PDF có mật khẩu** (hỏi mật khẩu khi mở) | UI "Tính năng hoãn lại" cuối, KT GĐ1 | Thiết kế nói rõ phải có ngay từ đầu | S |
| 1.18 | Kéo thả file vào cửa sổ để mở (có lớp phủ "Thả để mở") | UI 4A, 6 | App đang ghi "kéo thả sẽ có ở bản sau" | S |
| 1.19 | Thanh zoom nổi (pill) và ô chọn mức zoom 50 đến 6400% | UI 4B | Hiện zoom nằm ở status bar, chỉ có bước + / - | S |
| 1.20 | Chế độ trang: Hai trang, Hai trang có bìa, Trình chiếu (F5) | UI 4B | Hiện chỉ có Cuộn liên tục và Từng trang | M |
| 1.21 | Chế độ Đọc ban đêm và Sepia cho trang PDF | UI 2.2, KT GĐ1 | | S |
| 1.22 | Số trang nổi khi cuộn nhanh, thanh cuộn tuỳ biến | UI 4B | | S |
| 1.23 | Công cụ Chụp vùng (Snapshot) | UI 4B | | S |
| 1.24 | Điều hướng link: tooltip URL, hỏi trước khi mở link ngoài, nhấp nháy đích link nội bộ | UI 4B, KT 7 | Cần xác nhận trước khi mở link ngoài (bảo mật) | S |
| 1.25 | Lịch sử điều hướng (quay lại vị trí `Ctrl+[`, `Ctrl+]`, nút chuột Back) | UI 4B | | S |
| 1.26 | Sửa Mục lục: thêm, đổi tên, kéo lồng cấp bookmark; AI đề xuất mục lục | UI 4B | Hiện chỉ đọc | M |
| 1.27 | Thanh nổi khi chọn chữ ở chế độ Xem (Copy, Highlight, Hỏi AI, Dịch) | UI 4B | Có bộ chọn chữ nhưng chưa có thanh nổi | S |
| 1.28 | Chia đôi màn hình (Split view) | UI 1 ⑤, 7 | | M |
| 1.29 | Tài liệu nhớ trang, zoom, bố cục lần cuối | UI 1 | Cần SQLite | S |

### 1C. Hệ thống và nền tảng

| # | Hạng mục | Spec | Ghi chú | Cỡ |
|---|---|---|---|---|
| 1.30 | Hoàn tác/Làm lại toàn cục và tự lưu nháp, khôi phục khi app tắt đột ngột | KT 2, 5 | Hiện Undo chỉ có riêng trong Ghi chú và Organizer; không có mô hình tài liệu chung | L |
| 1.31 | Lưu an toàn (ghi file tạm rồi đổi tên, giữ 1 bản sao lưu) | KT 2, 5 | Cần kiểm tra mã lưu hiện tại có đúng atomic chưa | S |
| 1.32 | Cơ sở dữ liệu SQLite (file gần đây, ghim, cài đặt, workspace) | KT 5 | Nền cho 1.1, 1.13, 1.29 | M |
| 1.33 | Workspace (bố cục đã lưu), dock và panel nổi, chế độ Focus | UI 1 | | M |
| 1.34 | Responsive theo 6 breakpoint, cỡ cửa sổ tối thiểu 640×480, mật độ Gọn/Thoải mái, cỡ giao diện | UI 7, 4F | Có kiểm tra layout cơ bản, chưa có drawer/bottom sheet | M |
| 1.35 | Tiến trình PDF chạy trong tiến trình riêng (sandbox), JS trong PDF tắt | KT 7 | Rủi ro bảo mật khi mở PDF lạ | L |
| 1.36 | Đa ngôn ngữ giao diện, đổi màu nhấn | UI 4F | Hiện chỉ tiếng Việt cố định | M |
| 1.37 | Liên kết loại file `.pdf` (đặt Folioscope làm app mặc định) | KT GĐ1 | Phụ thuộc đóng gói | S |
| 1.38 | Bộ file PDF mẫu và test so ảnh tự động, test giao diện Playwright, đo hiệu năng | KT 9, GĐ0 | File mẫu cần ở ngoài kho vì bản quyền (đã ghi trong README) | M |

---

## Kế hoạch đề xuất: gom thành các gói việc

Chưa bắt đầu gói nào. Mỗi gói dưới đây là một PR hoặc một chuỗi PR nhỏ. Bạn nói "làm gói X" thì mới làm.

**Nguyên tắc sắp thứ tự:** làm trước thứ bạn dùng hằng ngày, làm trước thứ làm nền cho nhiều thứ khác (SQLite, mô hình tài liệu, hệ component), để phần khó nhất (sửa chữ) sau cùng khi nền đã vững.

### Gói A: Nền dùng chung (đã làm, xem `docs/foundation.md`)
- 1.32 SQLite, 2.10 hệ toast và component chuẩn, 1.31 lưu atomic, 2.11 danh sách lệnh và phím tắt dùng chung (nền cho Command Palette).
- Cỡ tổng: M đến L. Mở khoá cho B, C, D, F.

### Gói B: Hoàn thiện trình xem (làm sau A, song song với C)
- 1.17 mật khẩu (**ưu tiên cao nhất, thiết kế bắt buộc**), 1.18 kéo thả, 1.19 thanh zoom nổi, 1.20 các chế độ trang, 1.21 đọc ban đêm, 1.22, 1.23, 1.24, 1.25, 1.27, 2.5 vạch trên thanh cuộn, 1.14 In, 2.12 render theo ô và cache.
- Cỡ tổng: L. Có thể tách làm hai: B1 "tiện dùng" (1.17 đến 1.19, 1.21 đến 1.25, 1.27, toàn S) làm trước; B2 "hiệu năng và hiển thị" (1.20, 2.12, 1.14) làm sau.

### Gói C: Home, tab và tài liệu nhiều tab (sau A)
- 1.1 Home, 2.2 nhiều tab, 1.29 nhớ vị trí đọc, 2.1 phần còn thiếu của thanh công cụ.
- Cỡ tổng: L. Chạy song song với B được vì chạm vào phần khác của mã (khung ứng dụng, không phải viewer), nhưng cùng sửa `App.tsx` nên cần gộp cẩn thận.

### Gói D: Settings và Command Palette (sau A)
- 1.13 Settings, 1.12 Command Palette, 1.36 màu nhấn và cỡ giao diện, 2.11 tuỳ biến phím tắt, 1.34 responsive và mật độ.
- Cỡ tổng: L. Song song với B, C.

### Gói E: Hoàn thiện Trang và Gộp file (độc lập, làm bất cứ lúc nào)
- 2.9 phần còn lại của Organizer, 2.7 tuỳ chọn Gộp file, **tải thêm LibreOffice lần đầu cần (hoặc đóng kèm)**.
- Cỡ tổng: M. Độc lập hoàn toàn, chạy song song với mọi gói.

### Gói F: Ghi chú đầy đủ (sau A)
- 2.4: lưu đè, bảng màu, comment có trả lời và trạng thái, tem, đo đạc, callout, đính kèm; 2.3 rail Comments; 2.6 panel phải chi tiết comment; 1.30 Hoàn tác toàn cục (có thể tách riêng).
- Cỡ tổng: L. Song song với B, C, D nếu không chung file; riêng 1.30 chạm nhiều nơi nên nên làm riêng, không song song.

### Gói G: Chuyển đổi và OCR (sau A và E)
- 1.5 màn hình Convert, 1.6 PDF sang Office, 1.7 PDF/A, 1.8 tạo PDF, 1.9 OCR.
- Cỡ tổng: L. Làm sau E vì dùng chung cơ chế LibreOffice và hộp thoại tiến trình. OCR và PDF sang Office có thể tách thành hai PR chạy song song.

### Gói H: Chỉnh sửa nội dung (sau F, phần khó nhất)
- 1.2, 1.3, 1.4, 2.6 thuộc tính đối tượng.
- Cỡ tổng: L (5 đến 7 tuần theo KT). Cần 1.30 Hoàn tác toàn cục xong trước. Nên có bộ file PDF mẫu khó (1.38) trước khi bắt đầu.

### Gói I: So sánh và AI (sau A, D)
- 1.10 So sánh, 1.11 Trợ lý AI (kèm khoá API trong kho khoá hệ điều hành), 1.16 Đọc to, 1.15 Accessibility Checker.
- Cỡ tổng: L. So sánh và AI độc lập nhau, chạy song song được.

### Gói J: Tích hợp hệ điều hành và phát hành (làm cuối, một phần làm sớm)
- 2.8 menu chuột phải còn lại và macOS/Linux, 1.37 liên kết `.pdf`, 2.14 ký số, cập nhật tự động, MSIX; 1.35 sandbox PDF; 2.13 a11y; 1.38 test và đo hiệu năng.
- Cỡ tổng: L. Phần Windows (MSIX, mục menu thêm, liên kết `.pdf`) có thể làm sớm sau Gói B; macOS/Linux chỉ khi bạn cần.

### Sơ đồ thứ tự

```
A (nền) ──┬─> B (trình xem)  ─┐
          ├─> C (Home, tab)   ├─> H (chỉnh sửa nội dung) ──> J (phát hành)
          ├─> D (Settings)    │
          ├─> F (ghi chú) ────┘
          └─> I (so sánh, AI)
E (trang, gộp file) ──> G (chuyển đổi, OCR)      [E làm lúc nào cũng được]
```

### Gợi ý thứ tự thực tế nếu làm lần lượt

1. **B1** (mật khẩu, kéo thả, thanh zoom nổi): nhỏ, thấy hiệu quả ngay.
2. **A** (nền dùng chung).
3. **C** (Home và nhiều tab) cùng **E** (hoàn thiện Gộp file).
4. **D** (Settings, Command Palette) và **F** (ghi chú đầy đủ).
5. **G** (chuyển đổi, OCR), rồi **I** (So sánh, AI).
6. **H** (chỉnh sửa nội dung).
7. **J** (phát hành) và **B2**.

### Rủi ro cần lưu ý
- **Mở PDF có mật khẩu** đang thiếu dù thiết kế yêu cầu sẵn từ đầu. Nên làm sớm.
- **Hoàn tác toàn cục (1.30)** là điều kiện của Gói H. Nếu để muộn sẽ phải viết lại Ghi chú và Organizer.
- **LibreOffice** (2.7) đang bắt người dùng tự cài; cần quyết định đóng kèm hay tải khi cần trước khi làm Gói G.
- **Gói H** có rủi ro cao nhất (KT mục 11); cần bộ file mẫu khó trước khi bắt đầu.
- Hai gói chạy song song nên tránh cùng sửa `App.tsx` và `store.ts`; nên có một PR nhỏ tách `App.tsx` ra thành các vùng riêng trước (thuộc Gói A).
