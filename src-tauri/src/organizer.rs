//! Sắp xếp trang: ghép một tài liệu mới từ danh sách trang (có thể lấy từ nhiều file),
//! kèm xoay thêm. Dùng chung cho Lưu, Trích xuất và Tách file.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use pdfium_render::prelude::*;
use serde::Deserialize;

use crate::pdf::{bind, load, PdfError};

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
    /// Cắt lề: [trái, trên, phải, dưới] (pt), tính theo chiều trang đang hiển thị (đã xoay).
    #[serde(default)]
    pub crop: Option<[f32; 4]>,
    /// Số trang (hoặc chữ) in lên trang.
    #[serde(default)]
    pub stamp: Option<Stamp>,
}

/// Chữ in lên trang, dùng để đánh số trang.
#[derive(Debug, Deserialize)]
pub struct Stamp {
    pub text: String,
    /// Vị trí: "bl", "bc", "br" (dưới trái/giữa/phải) hoặc "tl", "tc", "tr" (trên).
    pub pos: String,
    pub size: f32,
    /// Khoảng cách tới mép trang (pt).
    pub margin: f32,
}

/// Hình chữ nhật trong hệ toạ độ trang: (trái, dưới, phải, trên).
pub type Box4 = (f32, f32, f32, f32);

/// Hình chữ nhật còn lại sau khi cắt `m` = [trái, trên, phải, dưới] tính theo chiều hiển thị,
/// quy về toạ độ gốc của trang với tổng góc xoay `rot` (0/90/180/270, chiều kim đồng hồ).
pub fn crop_rect(b: Box4, rot: i32, m: [f32; 4]) -> Option<Box4> {
    let (x0, y0, x1, y1) = b;
    let [l, t, r, bt] = m;
    let (nx0, ny0, nx1, ny1) = match rot.rem_euclid(360) {
        90 => (x0 + t, y0 + l, x1 - bt, y1 - r),
        180 => (x0 + r, y0 + t, x1 - l, y1 - bt),
        270 => (x0 + bt, y0 + r, x1 - t, y1 - l),
        _ => (x0 + l, y0 + bt, x1 - r, y1 - t),
    };
    // phần còn lại phải đủ lớn để nhìn thấy
    (nx1 - nx0 >= 12.0 && ny1 - ny0 >= 12.0).then_some((nx0, ny0, nx1, ny1))
}

/// Kích thước hiển thị (rộng, cao) của hình chữ nhật sau khi xoay `rot`.
pub fn display_dims(b: Box4, rot: i32) -> (f32, f32) {
    let (w, h) = (b.2 - b.0, b.3 - b.1);
    if rot.rem_euclid(180) == 90 { (h, w) } else { (w, h) }
}

/// Đổi điểm (u, v) tính từ góc dưới trái của trang đang hiển thị sang toạ độ gốc của trang.
pub fn display_to_page(b: Box4, rot: i32, u: f32, v: f32) -> (f32, f32) {
    let (x0, y0, x1, y1) = b;
    match rot.rem_euclid(360) {
        90 => (x1 - v, y0 + u),
        180 => (x1 - u, y1 - v),
        270 => (x0 + v, y1 - u),
        _ => (x0 + u, y0 + v),
    }
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

/// Cắt lề rồi in số trang lên một trang đã xoay xong.
fn decorate(page: &mut PdfPage, font: PdfFontToken, p: &PageRef) -> Result<(), PdfError> {
    let rot = degrees_of(page.rotation().unwrap_or(PdfPageRenderRotation::None));
    let current = |page: &PdfPage| -> Box4 {
        let r = page
            .boundaries()
            .crop()
            .or_else(|_| page.boundaries().media())
            .map(|b| b.bounds);
        match r {
            Ok(r) => (r.left().value, r.bottom().value, r.right().value, r.top().value),
            Err(_) => (0.0, 0.0, page.width().value, page.height().value),
        }
    };
    let mut area = current(page);
    if let Some(m) = p.crop {
        let Some(c) = crop_rect(area, rot, m) else {
            return Err(PdfError::Render("vùng cắt quá lớn, không còn lại phần nào của trang".into()));
        };
        let rect = PdfRect::new_from_values(c.1, c.0, c.3, c.2);
        page.boundaries_mut().set_crop(rect).map_err(|e| PdfError::Render(e.to_string()))?;
        area = c;
    }
    if let Some(st) = &p.stamp {
        let (dw, dh) = display_dims(area, rot);
        let mut obj = page
            .objects_mut()
            .create_text_object(PdfPoints::ZERO, PdfPoints::ZERO, &st.text, font, PdfPoints::new(st.size))
            .map_err(|e| PdfError::Render(e.to_string()))?;
        let tw = obj.width().map(|w| w.value).unwrap_or(st.text.chars().count() as f32 * st.size * 0.5);
        let (vert, horiz) = (st.pos.chars().next().unwrap_or('b'), st.pos.chars().nth(1).unwrap_or('c'));
        let u = match horiz {
            'l' => st.margin,
            'r' => dw - st.margin - tw,
            _ => (dw - tw) / 2.0,
        };
        let v = if vert == 't' { dh - st.margin - st.size * 0.75 } else { st.margin };
        let (x, y) = display_to_page(area, rot, u.max(0.0), v.max(0.0));
        // chữ luôn dựng thẳng trên trang đang hiển thị, nên xoay ngược chiều với góc xoay của trang
        obj.rotate_counter_clockwise_degrees(rot as f32).map_err(|e| PdfError::Render(e.to_string()))?;
        obj.translate(PdfPoints::new(x), PdfPoints::new(y)).map_err(|e| PdfError::Render(e.to_string()))?;
    }
    Ok(())
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
                    let doc = load(pdfium, src)?;
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
            if p.crop.is_some() || p.stamp.is_some() {
                let font = dest.fonts_mut().helvetica();
                let mut page = dest.pages().get(at).map_err(|_| PdfError::PageOutOfRange(n as u16))?;
                decorate(&mut page, font, p)?;
            }
        }
        dest.save_to_file(&tmp).map_err(|e| PdfError::Render(e.to_string()))?;
    } // đóng mọi tài liệu trước khi đổi tên (Windows không cho ghi đè file đang mở)

    crate::fsutil::commit_tmp(std::path::Path::new(&tmp), std::path::Path::new(&output), true).map_err(|e| {
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

    const BOX: Box4 = (0.0, 0.0, 600.0, 800.0);

    #[test]
    fn crop_margins_follow_page_rotation() {
        // lề [trái 10, trên 20, phải 30, dưới 40] theo chiều hiển thị
        let m = [10.0, 20.0, 30.0, 40.0];
        assert_eq!(crop_rect(BOX, 0, m), Some((10.0, 40.0, 570.0, 780.0)));
        // xoay 90°: mép trên hiển thị là mép trái gốc, mép phải hiển thị là mép trên gốc
        assert_eq!(crop_rect(BOX, 90, m), Some((20.0, 10.0, 560.0, 770.0)));
        assert_eq!(crop_rect(BOX, 180, m), Some((30.0, 20.0, 590.0, 760.0)));
        assert_eq!(crop_rect(BOX, 270, m), Some((40.0, 30.0, 580.0, 790.0)));
        assert_eq!(crop_rect(BOX, 0, [400.0, 0.0, 300.0, 0.0]), None);
    }

    #[test]
    fn display_points_map_back_to_page_space() {
        // góc dưới trái hiển thị: gốc (0,0) khi không xoay, góc dưới phải gốc khi xoay 90°
        assert_eq!(display_to_page(BOX, 0, 5.0, 7.0), (5.0, 7.0));
        assert_eq!(display_to_page(BOX, 90, 5.0, 7.0), (593.0, 5.0));
        assert_eq!(display_to_page(BOX, 180, 5.0, 7.0), (595.0, 793.0));
        assert_eq!(display_to_page(BOX, 270, 5.0, 7.0), (7.0, 795.0));
        assert_eq!(display_dims(BOX, 90), (800.0, 600.0));
    }

    /// Chạy thật khi đặt FOLIOSCOPE_TEST_PDF: cắt lề + đánh số trên trang xoay 90° rồi đọc lại.
    #[test]
    fn exports_cropped_and_numbered_pages() {
        let Ok(src) = std::env::var("FOLIOSCOPE_TEST_PDF") else { return };
        let out = std::env::temp_dir().join("folioscope-organizer-crop.pdf");
        let out = out.to_string_lossy().to_string();
        let stamp = |t: &str, pos: &str| Some(Stamp { text: t.into(), pos: pos.into(), size: 12.0, margin: 20.0 });
        let pages = vec![
            PageRef { source: Some(src.clone()), index: 0, rotate: 0, width: 0.0, height: 0.0,
                      crop: Some([30.0, 40.0, 50.0, 60.0]), stamp: stamp("Trang 1", "bc") },
            PageRef { source: Some(src.clone()), index: 1, rotate: 90, width: 0.0, height: 0.0,
                      crop: None, stamp: stamp("Trang 2", "tr") },
        ];
        assert_eq!(export_pages(pages, out.clone()).unwrap(), 2);
        let orig = crate::pdf::open_document(src, None).unwrap();
        let info = crate::pdf::open_document(out.clone(), None).unwrap();
        assert_eq!(info.page_sizes[0].0.round(), (orig.page_sizes[0].0 - 80.0).round());
        assert_eq!(info.page_sizes[0].1.round(), (orig.page_sizes[0].1 - 100.0).round());
        assert_eq!(info.page_sizes[1].0.round(), orig.page_sizes[1].1.round());

        let pdfium = bind().unwrap();
        let doc = load(pdfium, &out).unwrap();
        for (i, want) in ["Trang 1", "Trang 2"].iter().enumerate() {
            let page = doc.pages().get(i as i32).unwrap();
            let found = page.objects().iter().any(|o| o.as_text_object().is_some_and(|t| t.text() == *want));
            assert!(found, "trang {i} thiếu chữ {want}");
        }
        let _ = std::fs::remove_file(out);
    }

    /// Chạy thật khi đặt FOLIOSCOPE_TEST_PDF: đảo 3 trang đầu, xoay 90°, chèn trang trắng.
    #[test]
    fn exports_reordered_rotated_pages_with_blank() {
        let Ok(src) = std::env::var("FOLIOSCOPE_TEST_PDF") else { return };
        let out = std::env::temp_dir().join("folioscope-organizer-test.pdf");
        let out = out.to_string_lossy().to_string();
        let page = |i, rotate| PageRef { source: Some(src.clone()), index: i, rotate, width: 0.0, height: 0.0, crop: None, stamp: None };
        let pages = vec![
            page(2, 90),
            PageRef { source: None, index: 0, rotate: 0, width: 300.0, height: 400.0, crop: None, stamp: None },
            page(0, 0),
            page(1, -90),
        ];
        assert_eq!(export_pages(pages, out.clone()).unwrap(), 4);

        let info = crate::pdf::open_document(out.clone(), None).unwrap();
        assert_eq!(info.page_count, 4);
        let orig = crate::pdf::open_document(src, None).unwrap();
        // trang 3 gốc xoay 90° → rộng/cao đổi chỗ
        assert_eq!(info.page_sizes[0].0.round(), orig.page_sizes[2].1.round());
        assert_eq!(info.page_sizes[1].0.round(), 300.0);
        assert_eq!(info.page_sizes[2].0.round(), orig.page_sizes[0].0.round());
        let _ = std::fs::remove_file(out);
    }
}
