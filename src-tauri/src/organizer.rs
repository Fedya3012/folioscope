//! Sắp xếp trang: ghép một tài liệu mới từ danh sách trang (có thể lấy từ nhiều file),
//! kèm xoay thêm. Dùng chung cho Lưu, Trích xuất và Tách file.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use pdfium_render::prelude::*;
use serde::Deserialize;

use crate::pdf::{bind, PdfError};

/// Một trang của tài liệu kết quả.
#[derive(Debug, Deserialize)]
pub struct PageRef {
    /// File nguồn; `None` nghĩa là trang trắng.
    pub source: Option<String>,
    /// Số thứ tự trang trong file nguồn, bắt đầu từ 0 (bỏ qua với trang trắng).
    pub index: u16,
    /// Góc xoay thêm so với trang gốc, bội số của 90 (âm là xoay ngược chiều kim đồng hồ).
    pub rotate: i32,
    /// Kích thước (pt) của trang trắng.
    pub width: f32,
    pub height: f32,
}

/// Ghi file dựng tài liệu mới nên chạy lần lượt, không chồng lên nhau.
static EXPORT_LOCK: Mutex<()> = Mutex::new(());

fn rotation_from_degrees(deg: i32) -> PdfPageRenderRotation {
    match deg.rem_euclid(360) {
        90 => PdfPageRenderRotation::Degrees90,
        180 => PdfPageRenderRotation::Degrees180,
        270 => PdfPageRenderRotation::Degrees270,
        _ => PdfPageRenderRotation::None,
    }
}

fn degrees_of(r: PdfPageRenderRotation) -> i32 {
    match r {
        PdfPageRenderRotation::None => 0,
        PdfPageRenderRotation::Degrees90 => 90,
        PdfPageRenderRotation::Degrees180 => 180,
        PdfPageRenderRotation::Degrees270 => 270,
    }
}

/// Ghi `pages` thành file PDF mới tại `output`. Ghi qua file tạm rồi đổi tên, nên có thể
/// ghi đè đúng file đang là nguồn mà không làm hỏng nó nếu giữa chừng có lỗi.
#[tauri::command]
pub fn export_pages(pages: Vec<PageRef>, output: String) -> Result<u32, PdfError> {
    if pages.is_empty() {
        return Err(PdfError::Render("không có trang nào để ghi".into()));
    }
    let _guard = EXPORT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let pdfium = bind()?;
    let tmp = PathBuf::from(format!("{output}.folioscope-tmp"));
    let count = pages.len() as u32;

    {
        let mut sources: HashMap<&str, PdfDocument> = HashMap::new();
        for p in &pages {
            if let Some(src) = p.source.as_deref() {
                if !sources.contains_key(src) {
                    let doc = pdfium
                        .load_pdf_from_file(src, None)
                        .map_err(|e| PdfError::Open(format!("{src}: {e}")))?;
                    sources.insert(src, doc);
                }
            }
        }

        let mut dest = pdfium.create_new_pdf().map_err(|e| PdfError::Render(e.to_string()))?;
        for (n, p) in pages.iter().enumerate() {
            let at = n as i32;
            match p.source.as_deref() {
                Some(src) => {
                    let source = &sources[src];
                    dest.pages_mut()
                        .copy_page_from_document(source, p.index as i32, at)
                        .map_err(|_| PdfError::PageOutOfRange(p.index))?;
                }
                None => {
                    let size = PdfPagePaperSize::Custom(
                        PdfPoints::new(p.width),
                        PdfPoints::new(p.height),
                    );
                    dest.pages_mut()
                        .create_page_at_index(size, at)
                        .map_err(|e| PdfError::Render(e.to_string()))?;
                }
            }
            if p.rotate.rem_euclid(360) != 0 {
                let mut page = dest.pages().get(at).map_err(|_| PdfError::PageOutOfRange(n as u16))?;
                let now = degrees_of(page.rotation().unwrap_or(PdfPageRenderRotation::None));
                page.set_rotation(rotation_from_degrees(now + p.rotate));
            }
        }
        dest.save_to_file(&tmp).map_err(|e| PdfError::Render(e.to_string()))?;
    } // đóng mọi tài liệu trước khi đổi tên (Windows không cho ghi đè file đang mở)

    std::fs::rename(&tmp, &output).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        PdfError::Render(format!("không ghi được {output}: {e}"))
    })?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_wraps_around() {
        assert_eq!(degrees_of(rotation_from_degrees(-90)), 270);
        assert_eq!(degrees_of(rotation_from_degrees(450)), 90);
        assert_eq!(degrees_of(rotation_from_degrees(0)), 0);
    }

    /// Chạy thật khi đặt FOLIOSCOPE_TEST_PDF: đảo 3 trang đầu, xoay 90°, chèn trang trắng.
    #[test]
    fn exports_reordered_rotated_pages_with_blank() {
        let Ok(src) = std::env::var("FOLIOSCOPE_TEST_PDF") else { return };
        let out = std::env::temp_dir().join("folioscope-organizer-test.pdf");
        let out = out.to_string_lossy().to_string();
        let page = |i, rotate| PageRef { source: Some(src.clone()), index: i, rotate, width: 0.0, height: 0.0 };
        let pages = vec![
            page(2, 90),
            PageRef { source: None, index: 0, rotate: 0, width: 300.0, height: 400.0 },
            page(0, 0),
            page(1, -90),
        ];
        assert_eq!(export_pages(pages, out.clone()).unwrap(), 4);

        let info = crate::pdf::open_document(out.clone()).unwrap();
        assert_eq!(info.page_count, 4);
        let orig = crate::pdf::open_document(src).unwrap();
        // trang 3 gốc xoay 90° → rộng/cao đổi chỗ
        assert_eq!(info.page_sizes[0].0.round(), orig.page_sizes[2].1.round());
        assert_eq!(info.page_sizes[1].0.round(), 300.0);
        assert_eq!(info.page_sizes[2].0.round(), orig.page_sizes[0].0.round());
        let _ = std::fs::remove_file(out);
    }
}
