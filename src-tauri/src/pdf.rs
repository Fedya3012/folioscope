//! Mở và vẽ trang PDF bằng PDFium. Mọi việc nặng chạy ở đây, giao diện chỉ nhận ảnh.

use std::io::Cursor;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::ImageFormat;
use pdfium_render::prelude::*;
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum PdfError {
    #[error("không tìm thấy thư viện PDFium: {0}")]
    Library(String),
    #[error("không mở được file: {0}")]
    Open(String),
    /// Chuỗi cố định này được giao diện nhận ra để hiện hộp nhập mật khẩu; đừng đổi.
    #[error("PASSWORD_REQUIRED")]
    PasswordRequired,
    #[error("WRONG_PASSWORD")]
    WrongPassword,
    #[error("trang {0} không tồn tại")]
    PageOutOfRange(u16),
    #[error("lỗi vẽ trang: {0}")]
    Render(String),
    #[error("không lưu được ghi chú: {0}")]
    Save(String),
}

impl Serialize for PdfError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Serialize)]
pub struct DocumentInfo {
    pub page_count: u16,
    /// Kích thước từng trang theo điểm PDF (1pt = 1/72 inch), để dựng khung trước khi vẽ.
    pub page_sizes: Vec<(f32, f32)>,
}

#[derive(Serialize)]
pub struct RenderedPage {
    pub width: u32,
    pub height: u32,
    pub png_base64: String,
}

fn library_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(p) = std::env::var("FOLIOSCOPE_PDFIUM") {
        dirs.push(PathBuf::from(p));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.join("pdfium"));
            dirs.push(dir.to_path_buf());
        }
    }
    dirs.push(PathBuf::from("./pdfium"));
    dirs.push(PathBuf::from("./src-tauri/pdfium"));
    dirs
}

/// PDFium chỉ được nạp một lần cho cả tiến trình, nên giữ bản dùng chung.
static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();

pub(crate) fn bind() -> Result<&'static Pdfium, PdfError> {
    PDFIUM
        .get_or_init(|| {
            let mut last = String::from("không có đường dẫn nào");
            for dir in library_dirs() {
                let name = Pdfium::pdfium_platform_library_name_at_path(&dir);
                match Pdfium::bind_to_library(name) {
                    Ok(b) => return Ok(Pdfium::new(b)),
                    Err(e) => last = format!("{}: {e}", dir.display()),
                }
            }
            Err(last)
        })
        .as_ref()
        .map_err(|e| PdfError::Library(e.clone()))
}

/// Mật khẩu đã nhập đúng, theo đường dẫn file, để mọi lệnh sau (vẽ trang, tìm kiếm, lưu...) tự mở lại được.
/// Chỉ nằm trong bộ nhớ, không ghi ra đĩa.
static PASSWORDS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn passwords() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
    PASSWORDS.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

fn open_with<'a>(pdfium: &'a Pdfium, path: &str, password: Option<&str>) -> Result<PdfDocument<'a>, PdfError> {
    pdfium.load_pdf_from_file(path, password).map_err(|e| match e {
        PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError) => {
            if password.is_some() { PdfError::WrongPassword } else { PdfError::PasswordRequired }
        }
        other => PdfError::Open(other.to_string()),
    })
}

/// Bản sao không còn mật khẩu của một PDF (dùng khi gộp file). PDFium là bên quyết định mật khẩu đúng hay sai,
/// và đọc được cả file mã hoá dạng lopdf chưa xử lý được.
pub(crate) fn unlock_copy(path: &str, password: Option<&str>) -> Result<Vec<u8>, PdfError> {
    let pdfium = bind()?;
    let doc = open_with(pdfium, path, password)?;
    // Chép trang sang tài liệu mới: bản sao không mang theo mã hoá (dấu trang gốc của file khoá sẽ không được giữ).
    let mut copy = pdfium.create_new_pdf().map_err(|e| PdfError::Open(e.to_string()))?;
    copy.pages_mut().append(&doc).map_err(|e| PdfError::Open(e.to_string()))?;
    copy.save_to_bytes().map_err(|e| PdfError::Open(e.to_string()))
}

/// Mở file, dùng mật khẩu đã nhớ nếu có. Mọi chỗ cần mở PDF bằng PDFium nên gọi hàm này.
pub(crate) fn load<'a>(pdfium: &'a Pdfium, path: &str) -> Result<PdfDocument<'a>, PdfError> {
    let saved = passwords().get(path).cloned();
    open_with(pdfium, path, saved.as_deref())
}

#[tauri::command]
pub fn open_document(path: String, password: Option<String>) -> Result<DocumentInfo, PdfError> {
    let pdfium = bind()?;
    let doc = match password.as_deref() {
        Some(pw) => {
            let doc = open_with(pdfium, &path, Some(pw))?;
            passwords().insert(path.clone(), pw.to_string());
            doc
        }
        None => {
            passwords().remove(&path); // mở lại từ đầu thì không dùng mật khẩu cũ
            load(pdfium, &path)?
        }
    };
    let page_sizes = doc
        .pages()
        .iter()
        .map(|p| (p.width().value, p.height().value))
        .collect::<Vec<_>>();
    Ok(DocumentInfo { page_count: doc.pages().len() as u16, page_sizes })
}

#[tauri::command]
pub fn render_page(path: String, index: u16, width: u32) -> Result<RenderedPage, PdfError> {
    let pdfium = bind()?;
    let doc = load(pdfium, &path)?;
    let page = doc.pages().get(index as i32).map_err(|_| PdfError::PageOutOfRange(index))?;
    let bitmap = page
        .render_with_config(&PdfRenderConfig::new().set_target_width(width as i32))
        .map_err(|e| PdfError::Render(e.to_string()))?;
    let img = bitmap.as_image().map_err(|e| PdfError::Render(e.to_string()))?;
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| PdfError::Render(e.to_string()))?;
    Ok(RenderedPage {
        width: img.width(),
        height: img.height(),
        png_base64: STANDARD.encode(buf.into_inner()),
    })
}

/// Ghi ghi chú vào một bản sao; từ chối ghi đè chính file đang mở.
#[tauri::command]
pub fn save_annotations(path: String, out: String, items: Vec<crate::annotations::Item>) -> Result<usize, PdfError> {
    if std::path::Path::new(&path) == std::path::Path::new(&out) {
        return Err(PdfError::Save("không ghi đè file gốc, hãy chọn tên khác".into()));
    }
    let pdfium = bind()?;
    let doc = load(pdfium, &path)?;
    let n = crate::annotations::apply(&doc, &items).map_err(|e| PdfError::Save(e.to_string()))?;
    let out_path = std::path::Path::new(&out);
    let tmp = crate::fsutil::tmp_path(out_path);
    doc.save_to_file(&tmp).map_err(|e| { let _ = std::fs::remove_file(&tmp); PdfError::Save(e.to_string()) })?;
    drop(doc); // Windows không cho đổi tên khi file tạm còn mở
    crate::fsutil::commit_tmp(&tmp, out_path, true).map_err(|e| { let _ = std::fs::remove_file(&tmp); PdfError::Save(e.to_string()) })?;
    Ok(n)
}

#[cfg(test)]
/// PDF 1 trang mã hoá RC4, mật khẩu mở là "matkhau".
pub(crate) const ENCRYPTED_PDF: &str = "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDVmMjUyY2ZkNmU+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMzAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8YzQyYjU1NTk3MWE1YWMxYTE1OTRmMDM4NjZlMjY0ZjEyZDFlM2I2MTdlMzU3NzYyZTNiZTIwMzZlYjA5Yjc1MT4KL1UgPDJjY2ZiYjg0OGIzMjIzZGFlZmEyODk2NDY5MDEyOWUyMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDYyMzE2MzY1NjYzMDMzNjYzNDY1MzczNTM3Mzc2MjY2MzMzOTM2MzE2NDY1NjQ2MTM5MzYzNDM0Mzk2NTYxMzA+IDw2MjMxNjM2NTY2MzAzMzY2MzQ2NTM3MzUzNzM3NjI2NjMzMzkzNjMxNjQ2NTY0NjEzOTM2MzQzNDM5NjU2MTMwPiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK";

#[cfg(test)]
mod tests {
    use super::ENCRYPTED_PDF;
    use super::*;

    /// Chạy thật khi đặt FOLIOSCOPE_TEST_PDF trỏ tới một file PDF; bỏ qua nếu không đặt.
    #[test]
    fn renders_first_page_of_sample() {
        let Ok(path) = std::env::var("FOLIOSCOPE_TEST_PDF") else { return };
        let info = open_document(path.clone(), None).expect("mở được file mẫu");
        assert!(info.page_count > 0);
        let page = render_page(path, 0, 400).expect("vẽ được trang đầu");
        assert_eq!(page.width, 400);
        assert!(page.height > 0 && !page.png_base64.is_empty());
    }


    #[test]
    fn opens_password_protected_file() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let path = std::env::temp_dir().join("folioscope-password-test.pdf");
        std::fs::write(&path, STANDARD.decode(ENCRYPTED_PDF).unwrap()).unwrap();
        let p = path.to_string_lossy().to_string();

        assert!(matches!(open_document(p.clone(), None), Err(PdfError::PasswordRequired)));
        assert!(matches!(open_document(p.clone(), Some("sai".into())), Err(PdfError::WrongPassword)));
        assert!(render_page(p.clone(), 0, 100).is_err(), "chưa nhập đúng thì không vẽ được");

        let info = open_document(p.clone(), Some("matkhau".into())).expect("đúng mật khẩu thì mở được");
        assert_eq!(info.page_count, 1);
        // Các lệnh sau dùng lại mật khẩu đã nhớ.
        assert!(render_page(p.clone(), 0, 100).is_ok());
        // Mở lại không kèm mật khẩu thì phải hỏi lại.
        assert!(matches!(open_document(p, None), Err(PdfError::PasswordRequired)));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn password_errors_have_stable_markers() {
        assert_eq!(PdfError::PasswordRequired.to_string(), "PASSWORD_REQUIRED");
        assert_eq!(PdfError::WrongPassword.to_string(), "WRONG_PASSWORD");
    }

    #[test]
    fn page_out_of_range_message_is_vietnamese() {
        assert_eq!(PdfError::PageOutOfRange(7).to_string(), "trang 7 không tồn tại");
    }

    /// Lưu đủ 10 loại ghi chú vào bản sao rồi mở lại để đếm. Chạy khi đặt FOLIOSCOPE_TEST_PDF.
    #[test]
    fn saves_every_annotation_kind() {
        use crate::annotations::{Item, Pt, Rect};
        let Ok(path) = std::env::var("FOLIOSCOPE_TEST_PDF") else { return };
        let out = std::env::temp_dir().join("folioscope-annot-test.pdf");
        let r = Some(Rect { x: 0.1, y: 0.1, w: 0.3, h: 0.05 });
        let line = Some(vec![Pt { x: 0.1, y: 0.5 }, Pt { x: 0.5, y: 0.6 }, Pt { x: 0.6, y: 0.7 }]);
        let mk = |kind: &str, rect, points| Item {
            page: 0, kind: kind.into(), color: "#FF453A".into(), stroke_width: 2.0, rect, points, text: Some("xin chào".into()),
        };
        let items: Vec<Item> = ["highlight", "underline", "strikeout", "note", "text", "rect", "ellipse"]
            .iter().map(|k| mk(k, r, None))
            .chain(["line", "arrow", "ink"].iter().map(|k| mk(k, None, line.clone())))
            .collect();
        let n = save_annotations(path.clone(), out.to_string_lossy().into(), items).expect("lưu được");
        assert_eq!(n, 10);
        assert!(save_annotations(path.clone(), path, vec![]).is_err(), "không được ghi đè file gốc");
        let doc = bind().unwrap().load_pdf_from_file(&out, None).unwrap();
        assert_eq!(doc.pages().get(0).unwrap().annotations().len(), 10);
    }
}
