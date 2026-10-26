//! Mở và vẽ trang PDF bằng PDFium. Mọi việc nặng chạy ở đây, giao diện chỉ nhận ảnh.

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::OnceLock;

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

fn bind() -> Result<&'static Pdfium, PdfError> {
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

#[tauri::command]
pub fn open_document(path: String) -> Result<DocumentInfo, PdfError> {
    let pdfium = bind()?;
    let doc = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|e| PdfError::Open(e.to_string()))?;
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
    let doc = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|e| PdfError::Open(e.to_string()))?;
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
    let doc = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|e| PdfError::Open(e.to_string()))?;
    let n = crate::annotations::apply(&doc, &items).map_err(|e| PdfError::Save(e.to_string()))?;
    doc.save_to_file(&out).map_err(|e| PdfError::Save(e.to_string()))?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Chạy thật khi đặt FOLIOSCOPE_TEST_PDF trỏ tới một file PDF; bỏ qua nếu không đặt.
    #[test]
    fn renders_first_page_of_sample() {
        let Ok(path) = std::env::var("FOLIOSCOPE_TEST_PDF") else { return };
        let info = open_document(path.clone()).expect("mở được file mẫu");
        assert!(info.page_count > 0);
        let page = render_page(path, 0, 400).expect("vẽ được trang đầu");
        assert_eq!(page.width, 400);
        assert!(page.height > 0 && !page.png_base64.is_empty());
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
