//! Thông tin gắn theo trang bằng lopdf: hiệu ứng chuyển trang (/Trans, /Dur) và hình thu nhỏ nhúng (/Thumb).
//! Mọi lệnh ghi ra một bản sao (không ghi đè file đang mở).

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use pdfium_render::prelude::*;
use serde::Deserialize;

use crate::pdf::{bind, load, PdfError};

/// Kiểu chuyển trang PDF cho phép (khoá /S).
pub const STYLES: [&str; 12] = ["Split", "Blinds", "Box", "Wipe", "Dissolve", "Glitter", "R", "Fly", "Push", "Cover", "Uncover", "Fade"];

#[derive(Debug, Deserialize)]
pub struct TransitionSpec {
    /// None hoặc "none" là gỡ hiệu ứng.
    pub style: Option<String>,
    /// Thời gian hiệu ứng (giây).
    pub duration: f32,
    /// Tự lật sau n giây (/Dur); None là không tự lật.
    pub auto_advance: Option<f32>,
}

fn err(e: impl ToString) -> PdfError { PdfError::Save(e.to_string()) }

fn page_ids(doc: &Document, pages: &[u16]) -> Result<Vec<ObjectId>, PdfError> {
    let all: Vec<ObjectId> = doc.get_pages().into_values().collect();
    pages.iter().map(|&p| all.get(p as usize).copied().ok_or(PdfError::PageOutOfRange(p))).collect()
}

/// Đặt (hoặc gỡ) hiệu ứng chuyển trang cho các trang `pages` (từ 0). Phần lõi thuần lopdf để test.
pub fn apply_transitions(doc: &mut Document, pages: &[u16], spec: &TransitionSpec) -> Result<(), PdfError> {
    let style = spec.style.as_deref().filter(|s| !s.eq_ignore_ascii_case("none"));
    if let Some(s) = style {
        if !STYLES.contains(&s) { return Err(err(format!("kiểu chuyển trang không hợp lệ: {s}"))); }
    }
    for id in page_ids(doc, pages)? {
        let dict = doc.get_object_mut(id).and_then(|o| o.as_dict_mut()).map_err(err)?;
        match style {
            Some(s) => {
                let d = spec.duration.clamp(0.0, 60.0);
                dict.set("Trans", Object::Dictionary(dictionary! { "Type" => "Trans", "S" => Object::Name(s.as_bytes().to_vec()), "D" => d }));
            }
            None => { dict.remove(b"Trans"); }
        }
        match spec.auto_advance {
            Some(secs) if secs > 0.0 => dict.set("Dur", secs.min(3600.0)),
            _ => { dict.remove(b"Dur"); }
        }
    }
    Ok(())
}

/// Số trang đang có hiệu ứng chuyển trang.
pub fn count_transitions(doc: &Document) -> usize {
    doc.get_pages().values().filter(|id| doc.get_dictionary(**id).map(|d| d.has(b"Trans")).unwrap_or(false)).count()
}

/// Gỡ hình thu nhỏ nhúng khỏi mọi trang; trả số trang đã gỡ.
pub fn strip_thumbnails(doc: &mut Document) -> usize {
    let ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let mut n = 0;
    for id in ids {
        if let Ok(d) = doc.get_object_mut(id).and_then(|o| o.as_dict_mut()) {
            if d.remove(b"Thumb").is_some() { n += 1; }
        }
    }
    n
}

/// Gắn ảnh RGB (rộng w, cao h) làm /Thumb của trang.
pub fn attach_thumbnail(doc: &mut Document, page: ObjectId, w: u32, h: u32, rgb: Vec<u8>) -> Result<(), PdfError> {
    let dict: Dictionary = dictionary! {
        "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
        "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
    };
    let mut s = Stream::new(dict, rgb);
    let _ = s.compress();
    let img = doc.add_object(s);
    doc.get_object_mut(page).and_then(|o| o.as_dict_mut()).map_err(err)?.set("Thumb", Object::Reference(img));
    Ok(())
}

fn save_copy(doc: &mut Document, path: &str, out: &str) -> Result<(), PdfError> {
    if std::path::Path::new(path) == std::path::Path::new(out) {
        return Err(err("không ghi đè file gốc, hãy chọn tên khác"));
    }
    crate::combine::write_atomic(doc, std::path::Path::new(out), false).map(|_| ()).map_err(err)
}

fn open_lopdf(path: &str) -> Result<Document, PdfError> {
    let doc = Document::load(path).map_err(|e| PdfError::Open(e.to_string()))?;
    if doc.is_encrypted() { return Err(PdfError::Open("file có mật khẩu: hãy gỡ mật khẩu trước".into())); }
    Ok(doc)
}

#[tauri::command]
pub fn set_page_transitions(path: String, pages: Vec<u16>, spec: TransitionSpec, output: String) -> Result<usize, PdfError> {
    let mut doc = open_lopdf(&path)?;
    apply_transitions(&mut doc, &pages, &spec)?;
    save_copy(&mut doc, &path, &output)?;
    Ok(pages.len())
}

/// Nhúng hình thu nhỏ (rộng `width` px) vào mọi trang, hoặc gỡ nếu `embed` là false. Trả số trang đã đổi.
#[tauri::command]
pub fn set_embedded_thumbnails(path: String, embed: bool, width: Option<u32>, output: String) -> Result<usize, PdfError> {
    let mut doc = open_lopdf(&path)?;
    let n = if embed {
        let w = width.unwrap_or(105).clamp(32, 256);
        let pdfium = bind()?;
        let src = load(pdfium, &path)?;
        let ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
        for (i, id) in ids.iter().enumerate() {
            let page = src.pages().get(i as i32).map_err(|_| PdfError::PageOutOfRange(i as u16))?;
            let bitmap = page.render_with_config(&PdfRenderConfig::new().set_target_width(w as i32)).map_err(|e| PdfError::Render(e.to_string()))?;
            let rgb = bitmap.as_image().map_err(|e| PdfError::Render(e.to_string()))?.to_rgb8();
            attach_thumbnail(&mut doc, *id, rgb.width(), rgb.height(), rgb.into_raw())?;
        }
        ids.len()
    } else {
        strip_thumbnails(&mut doc)
    };
    save_copy(&mut doc, &path, &output)?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(n: usize) -> Document {
        let mut d = Document::with_version("1.5");
        let pages_id = d.new_object_id();
        let kids: Vec<Object> = (0..n).map(|_| Object::Reference(d.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id }))).collect();
        d.objects.insert(pages_id, Object::Dictionary(dictionary! {
            "Type" => "Pages", "Kids" => kids, "Count" => n as i64,
            "MediaBox" => vec![0.into(), 0.into(), 200.into(), 300.into()],
        }));
        let cat = d.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        d.trailer.set("Root", cat);
        d
    }

    #[test]
    fn transitions_set_and_clear() {
        let mut d = doc(3);
        let spec = TransitionSpec { style: Some("Fade".into()), duration: 0.5, auto_advance: Some(5.0) };
        apply_transitions(&mut d, &[0, 2], &spec).unwrap();
        assert_eq!(count_transitions(&d), 2);
        let p0 = *d.get_pages().get(&1).unwrap();
        assert!(d.get_dictionary(p0).unwrap().has(b"Dur"));
        apply_transitions(&mut d, &[0, 2], &TransitionSpec { style: None, duration: 1.0, auto_advance: None }).unwrap();
        assert_eq!(count_transitions(&d), 0);
        assert!(!d.get_dictionary(p0).unwrap().has(b"Dur"));
    }

    #[test]
    fn rejects_bad_style_and_page() {
        let mut d = doc(1);
        let bad = TransitionSpec { style: Some("Zoom".into()), duration: 1.0, auto_advance: None };
        assert!(apply_transitions(&mut d, &[0], &bad).is_err());
        let ok = TransitionSpec { style: Some("Wipe".into()), duration: 1.0, auto_advance: None };
        assert!(matches!(apply_transitions(&mut d, &[5], &ok), Err(PdfError::PageOutOfRange(5))));
    }

    #[test]
    fn thumbnails_attach_and_strip() {
        let mut d = doc(2);
        let ids: Vec<ObjectId> = d.get_pages().into_values().collect();
        for id in &ids { attach_thumbnail(&mut d, *id, 2, 2, vec![0u8; 12]).unwrap(); }
        assert!(d.get_dictionary(ids[0]).unwrap().has(b"Thumb"));
        assert_eq!(strip_thumbnails(&mut d), 2);
        assert_eq!(strip_thumbnails(&mut d), 0);
    }
}
