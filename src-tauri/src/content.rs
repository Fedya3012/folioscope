//! Sửa nội dung có sẵn trong trang PDF: chữ, ảnh và hình vẽ (đường, khung, tô màu).
//! Mỗi "đối tượng" là một đối tượng trang của PDFium; mã của nó là số thứ tự trong trang của file gốc.
//! Giao diện giữ danh sách sửa đổi; ở đây chỉ áp danh sách đó lên một bản mở trong bộ nhớ,
//! để xem trước (vẽ lại một trang) hoặc để ghi ra bản sao.
//! Toạ độ từ giao diện là tỉ lệ 0..1, gốc ở góc trên trái, như phần còn lại của app.

use std::collections::BTreeMap;
use std::path::Path;

use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};

use crate::annotations::parse_color;
use crate::pdf::{bind, load, render_png, PdfError, RenderedPage};
use crate::viewer::{norm, NormRect};

/// Trang xoay hoặc có lề gốc khác 0 vẫn phải tính toạ độ đúng, nên mọi đổi chỗ qua hai hàm này.
fn page_origin(page: &PdfPage) -> (f32, f32) {
    page.boundaries().media().map(|b| (b.bounds.left().value, b.bounds.bottom().value)).unwrap_or((0.0, 0.0))
}

fn to_norm(r: &PdfRect, page: &PdfPage) -> NormRect {
    let (ox, oy) = page_origin(page);
    let shifted = PdfRect::new_from_values(r.bottom().value - oy, r.left().value - ox, r.top().value - oy, r.right().value - ox);
    norm(&shifted, page.width().value, page.height().value)
}

/// Hình chữ nhật theo tỉ lệ -> (trái, dưới, rộng, cao) theo điểm PDF.
fn to_pdf(r: NormRect, page: &PdfPage) -> (f32, f32, f32, f32) {
    let (ox, oy) = page_origin(page);
    let (pw, ph) = (page.width().value, page.height().value);
    (ox + r[0] * pw, oy + (1.0 - r[1] - r[3]) * ph, r[2] * pw, r[3] * ph)
}

fn hex(c: PdfColor) -> String {
    format!("#{:02X}{:02X}{:02X}", c.red(), c.green(), c.blue())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageObject {
    /// Số thứ tự trong trang của file gốc; dùng làm mã để gửi lại khi sửa.
    pub id: u32,
    /// "text" | "image" | "shape" | "group"
    pub kind: &'static str,
    pub rect: NormRect,
    pub text: Option<String>,
    /// Cỡ chữ nhìn thấy trên trang (pt).
    pub size: Option<f32>,
    pub font: Option<String>,
    pub bold: bool,
    pub italic: bool,
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f32>,
}

fn is_bold(f: &PdfFont) -> bool {
    f.weight().map(|w| matches!(w, PdfFontWeight::Weight700Bold | PdfFontWeight::Weight800 | PdfFontWeight::Weight900)).unwrap_or(false)
        || f.name().to_lowercase().contains("bold")
}

fn describe(id: u32, obj: &PdfPageObject, page: &PdfPage) -> Option<PageObject> {
    let b = obj.bounds().ok()?.to_rect();
    if b.width().value < 0.5 || b.height().value < 0.5 {
        return None; // đối tượng rỗng hoặc chỉ là đường cắt vô hình
    }
    let rect = to_norm(&b, page);
    let mut o = PageObject {
        id, kind: "group", rect, text: None, size: None, font: None, bold: false, italic: false,
        fill: None, stroke: None, stroke_width: None,
    };
    match obj {
        PdfPageObject::Text(t) => {
            let text = t.text();
            if text.trim().is_empty() {
                return None;
            }
            let font = t.font();
            o.kind = "text";
            o.text = Some(text);
            o.size = Some(t.scaled_font_size().value);
            o.font = Some(font.name());
            o.bold = is_bold(&font);
            o.italic = font.is_italic();
            o.fill = t.fill_color().ok().map(hex);
        }
        PdfPageObject::Image(_) => o.kind = "image",
        PdfPageObject::Path(p) => {
            o.kind = "shape";
            let filled = p.fill_mode().map(|m| m != PdfPathFillMode::None).unwrap_or(false);
            let stroked = p.is_stroked().unwrap_or(false);
            o.fill = if filled { p.fill_color().ok().map(hex) } else { None };
            o.stroke = if stroked { p.stroke_color().ok().map(hex) } else { None };
            o.stroke_width = if stroked { p.stroke_width().ok().map(|w| w.value) } else { None };
        }
        PdfPageObject::XObjectForm(_) => {}
        _ => return None, // đổ bóng và loại lạ: chỉ hiển thị, không sửa
    }
    Some(o)
}

fn check_rotation(page: &PdfPage) -> Result<(), PdfError> {
    match page.rotation() {
        Ok(PdfPageRenderRotation::None) | Err(_) => Ok(()),
        Ok(_) => Err(PdfError::Edit("trang đang xoay, hãy xoay về 0° (chế độ Trang) rồi mới sửa nội dung".into())),
    }
}

#[tauri::command]
pub fn list_page_objects(path: String, index: u16) -> Result<Vec<PageObject>, PdfError> {
    let pdfium = bind()?;
    let doc = load(pdfium, &path)?;
    let page = doc.pages().get(index as i32).map_err(|_| PdfError::PageOutOfRange(index))?;
    check_rotation(&page)?;
    Ok(page.objects().iter().enumerate().filter_map(|(i, o)| describe(i as u32, &o, &page)).collect())
}

/// Một đối tượng đã sửa. Chỉ các trường có giá trị mới được áp.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjEdit {
    pub page: u16,
    pub id: u32,
    #[serde(default)]
    pub deleted: bool,
    /// Khung đích của đối tượng (cùng hệ toạ độ với `rect` lúc liệt kê).
    pub rect: Option<NormRect>,
    pub text: Option<String>,
    pub size: Option<f32>,
    pub bold: Option<bool>,
    /// "#RRGGBB", hoặc "none" để bỏ tô.
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f32>,
    /// Đường dẫn ảnh thay thế.
    pub image: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct IdRect {
    pub id: u32,
    pub rect: NormRect,
}

fn font_candidates(bold: bool, italic: bool) -> Vec<&'static str> {
    let style = (bold, italic);
    let pick = |a: &'static str, b: &'static str, c: &'static str, d: &'static str| match style {
        (false, false) => a,
        (true, false) => b,
        (false, true) => c,
        (true, true) => d,
    };
    vec![
        // Windows (Arial có đủ tiếng Việt)
        pick("C:\\Windows\\Fonts\\arial.ttf", "C:\\Windows\\Fonts\\arialbd.ttf", "C:\\Windows\\Fonts\\ariali.ttf", "C:\\Windows\\Fonts\\arialbi.ttf"),
        // macOS
        pick("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Italic.ttf", "/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf"),
        // Linux
        pick("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf"),
        pick("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf"),
        pick("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf", "/usr/share/fonts/truetype/noto/NotoSans-BoldItalic.ttf"),
    ]
}

/// Phông dùng để viết chữ mới: ưu tiên phông hệ thống có đủ tiếng Việt, nhúng vào file; không có thì dùng Helvetica có sẵn.
#[derive(Default)]
struct Fonts {
    loaded: BTreeMap<(bool, bool), PdfFontToken>,
    /// True khi phải dùng Helvetica (không đủ dấu tiếng Việt).
    fallback_used: bool,
}

impl Fonts {
    fn get(&mut self, doc: &mut PdfDocument, bold: bool, italic: bool) -> PdfFontToken {
        if let Some(t) = self.loaded.get(&(bold, italic)) {
            return *t;
        }
        let from_system = font_candidates(bold, italic).into_iter().find_map(|p| {
            let bytes = std::fs::read(p).ok()?;
            doc.fonts_mut().load_true_type_from_bytes(&bytes, true).ok()
        });
        let token = from_system.unwrap_or_else(|| {
            self.fallback_used = true;
            match (bold, italic) {
                (false, false) => doc.fonts_mut().helvetica(),
                (true, false) => doc.fonts_mut().helvetica_bold(),
                (false, true) => doc.fonts_mut().helvetica_oblique(),
                (true, true) => doc.fonts_mut().helvetica_bold_oblique(),
            }
        });
        self.loaded.insert((bold, italic), token);
        token
    }
}

/// Đưa đối tượng từ khung cũ `b` sang khung đích; chữ chỉ đổi chỗ (không co giãn).
fn place(obj: &mut PdfPageObject, b: &PdfRect, target: (f32, f32, f32, f32), resize: bool) -> Result<(), PdfiumError> {
    let (tl, tb, tw, th) = target;
    let (bw, bh) = (b.width().value, b.height().value);
    let (sx, sy) = if resize && bw > 0.01 && bh > 0.01 && tw > 0.5 && th > 0.5 { (tw / bw, th / bh) } else { (1.0, 1.0) };
    let (dx, dy) = (tl - b.left().value * sx, tb - b.bottom().value * sy);
    if (sx - 1.0).abs() < 1e-4 && (sy - 1.0).abs() < 1e-4 && dx.abs() < 1e-3 && dy.abs() < 1e-3 {
        return Ok(());
    }
    obj.transform(sx, 0.0, 0.0, sy, dx, dy)
}

fn apply_page(doc: &mut PdfDocument, page_index: u16, edits: &[&ObjEdit], fonts: &mut Fonts) -> Result<Vec<IdRect>, PdfError> {
    let err = |e: PdfiumError| PdfError::Edit(e.to_string());
    let mut page = doc.pages().get(page_index as i32).map_err(|_| PdfError::PageOutOfRange(page_index))?;
    check_rotation(&page)?;
    let mut remove: Vec<usize> = Vec::new();
    let mut touched: Vec<IdRect> = Vec::new();
    let mut sorted: Vec<&&ObjEdit> = edits.iter().collect();
    sorted.sort_by_key(|e| e.id);

    for e in sorted {
        let idx = e.id as usize;
        if e.deleted {
            remove.push(idx);
            continue;
        }
        let mut obj = page.objects().get(idx).map_err(|_| PdfError::Edit(format!("không thấy đối tượng {} trên trang {}", e.id, page_index + 1)))?;
        let b = obj.bounds().map_err(err)?.to_rect();
        let target = e.rect.map(|r| to_pdf(r, &page));

        // Chữ đổi nội dung hoặc đậm/nhạt: viết lại bằng phông hệ thống, xoá chữ cũ.
        if let PdfPageObject::Text(t) = &obj {
            let old_text = t.text();
            let (was_bold, italic) = {
                let f = t.font();
                (is_bold(&f), f.is_italic())
            };
            let bold = e.bold.unwrap_or(was_bold);
            let new_text = e.text.clone().filter(|x| *x != old_text && !x.is_empty());
            if new_text.is_some() || bold != was_bold {
                let scaled = t.scaled_font_size().value;
                let unscaled = t.unscaled_font_size().value.max(0.01);
                let ratio = (scaled / unscaled).max(0.01);
                let size = e.size.map(|s| s.max(1.0) / ratio).unwrap_or(unscaled);
                let color = match e.fill.as_deref() {
                    Some(c) if c != "none" => parse_color(c, 255),
                    _ => t.fill_color().unwrap_or(PdfColor::BLACK),
                };
                let matrix = t.matrix().ok();
                drop(obj);
                let token = fonts.get(doc, bold, italic);
                let mut fresh = PdfPageTextObject::new(doc, new_text.unwrap_or(old_text), token, PdfPoints::new(size)).map_err(err)?;
                fresh.set_fill_color(color).map_err(err)?;
                if let Some(m) = matrix {
                    fresh.reset_matrix(m).map_err(err)?;
                }
                let mut added = page.objects_mut().add_text_object(fresh).map_err(err)?;
                let nb = added.bounds().map_err(err)?.to_rect();
                // Giữ mép trái và đường đáy như chữ cũ (hoặc theo khung đích khi đã kéo đi chỗ khác).
                let (tl, tb) = match target {
                    Some((l, bt, _, _)) => (l, bt),
                    None => (b.left().value, b.bottom().value),
                };
                let (dx, dy) = (tl - nb.left().value, tb - nb.bottom().value);
                if dx.abs() > 1e-3 || dy.abs() > 1e-3 {
                    added.translate(PdfPoints::new(dx), PdfPoints::new(dy)).map_err(err)?;
                }
                let fb = added.bounds().map_err(err)?.to_rect();
                touched.push(IdRect { id: e.id, rect: to_norm(&fb, &page) });
                remove.push(idx);
                continue;
            }
        }

        match &mut obj {
            PdfPageObject::Text(t) => {
                // Chỉ đổi cỡ hoặc màu: giữ nguyên phông gốc.
                let scaled = t.scaled_font_size().value;
                let unscaled = t.unscaled_font_size().value.max(0.01);
                let ratio = (scaled / unscaled).max(0.01);
                if let Some(s) = e.size {
                    t.set_unscaled_font_size(PdfPoints::new(s.max(1.0) / ratio)).map_err(err)?;
                }
                if let Some(c) = e.fill.as_deref().filter(|c| *c != "none") {
                    t.set_fill_color(parse_color(c, 255)).map_err(err)?;
                }
            }
            PdfPageObject::Image(img) => {
                if let Some(file) = &e.image {
                    let pic = image::open(Path::new(file)).map_err(|e| PdfError::Edit(format!("không đọc được ảnh {file}: {e}")))?;
                    img.set_image(&pic).map_err(err)?;
                }
            }
            PdfPageObject::Path(p) => {
                let mut filled = p.fill_mode().map(|m| m != PdfPathFillMode::None).unwrap_or(false);
                let mut stroked = p.is_stroked().unwrap_or(false);
                match e.fill.as_deref() {
                    Some("none") => filled = false,
                    Some(c) => {
                        p.set_fill_color(parse_color(c, 255)).map_err(err)?;
                        filled = true;
                    }
                    None => {}
                }
                match e.stroke.as_deref() {
                    Some("none") => stroked = false,
                    Some(c) => {
                        p.set_stroke_color(parse_color(c, 255)).map_err(err)?;
                        stroked = true;
                    }
                    None => {}
                }
                if let Some(w) = e.stroke_width {
                    p.set_stroke_width(PdfPoints::new(w.max(0.0))).map_err(err)?;
                }
                p.set_fill_and_stroke_mode(if filled { PdfPathFillMode::Winding } else { PdfPathFillMode::None }, stroked).map_err(err)?;
            }
            _ => {}
        }

        if let Some(t) = target {
            let is_text = matches!(obj, PdfPageObject::Text(_));
            place(&mut obj, &b, t, !is_text).map_err(err)?;
        }
        if let Ok(nb) = obj.bounds() {
            touched.push(IdRect { id: e.id, rect: to_norm(&nb.to_rect(), &page) });
        }
    }

    // Xoá từ cuối lên đầu để số thứ tự các đối tượng còn lại không bị lệch.
    remove.sort_unstable();
    remove.dedup();
    for i in remove.into_iter().rev() {
        page.objects_mut().remove_object_at_index(i).map_err(err)?;
    }
    page.regenerate_content().map_err(err)?;
    Ok(touched)
}

/// Áp toàn bộ sửa đổi lên tài liệu đang mở. Trả về số đối tượng đã sửa và có phải dùng phông dự phòng không.
fn apply(doc: &mut PdfDocument, edits: &[ObjEdit], only_page: Option<u16>) -> Result<(Vec<IdRect>, bool), PdfError> {
    let mut by_page: BTreeMap<u16, Vec<&ObjEdit>> = BTreeMap::new();
    for e in edits {
        if only_page.map_or(true, |p| p == e.page) {
            by_page.entry(e.page).or_default().push(e);
        }
    }
    let mut fonts = Fonts::default();
    let mut all = Vec::new();
    for (page, list) in by_page {
        all.extend(apply_page(doc, page, &list, &mut fonts)?);
    }
    Ok((all, fonts.fallback_used))
}

#[derive(Serialize)]
pub struct EditedRender {
    pub page: RenderedPage,
    /// Khung mới của các đối tượng đã sửa (chữ đổi nội dung thì bề rộng thay đổi).
    pub rects: Vec<IdRect>,
}

/// Vẽ lại một trang với các sửa đổi đã chọn, không ghi gì ra đĩa.
#[tauri::command]
pub fn render_page_edited(path: String, index: u16, width: u32, edits: Vec<ObjEdit>) -> Result<EditedRender, PdfError> {
    let pdfium = bind()?;
    let mut doc = load(pdfium, &path)?;
    let (rects, _) = apply(&mut doc, &edits, Some(index))?;
    let page = doc.pages().get(index as i32).map_err(|_| PdfError::PageOutOfRange(index))?;
    Ok(EditedRender { page: render_png(&page, width)?, rects })
}

#[derive(Serialize)]
pub struct SaveResult {
    pub applied: usize,
    /// True khi máy không có phông Unicode nên chữ mới dùng Helvetica (có thể thiếu dấu tiếng Việt).
    pub font_fallback: bool,
}

/// Ghi mọi sửa đổi ra `out`. Cho phép ghi đè chính file gốc: bản cũ được giữ lại thành `.bak`.
#[tauri::command]
pub fn save_content_edits(path: String, out: String, edits: Vec<ObjEdit>) -> Result<SaveResult, PdfError> {
    let pdfium = bind()?;
    let mut doc = load(pdfium, &path)?;
    let (done, font_fallback) = apply(&mut doc, &edits, None)?;
    let out_path = Path::new(&out);
    let tmp = crate::fsutil::tmp_path(out_path);
    doc.save_to_file(&tmp).map_err(|e| { let _ = std::fs::remove_file(&tmp); PdfError::Save(e.to_string()) })?;
    drop(doc); // Windows không cho đổi tên khi file tạm còn mở
    crate::fsutil::commit_tmp(&tmp, out_path, true).map_err(|e| { let _ = std::fs::remove_file(&tmp); PdfError::Save(e.to_string()) })?;
    Ok(SaveResult { applied: done.len().max(edits.len()), font_fallback })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PDF thử: 1 dòng chữ có dấu, 1 hình chữ nhật tô đỏ, 1 ảnh nhỏ.
    fn make_pdf(name: &str) -> String {
        let pdfium = bind().expect("cần thư viện PDFium (npm run fetch-pdfium)");
        let mut doc = pdfium.create_new_pdf().unwrap();
        let mut page = doc.pages_mut().create_page_at_end(PdfPagePaperSize::a4()).unwrap();
        let font = doc.fonts_mut().helvetica();
        page.objects_mut().create_text_object(PdfPoints::new(72.0), PdfPoints::new(700.0), "Hello world", font, PdfPoints::new(18.0)).unwrap();
        let mut rect = PdfPagePathObject::new_rect(&doc, PdfRect::new_from_values(400.0, 100.0, 450.0, 200.0), Some(PdfColor::BLACK), Some(PdfPoints::new(1.0)), Some(PdfColor::new(255, 0, 0, 255))).unwrap();
        rect.set_fill_and_stroke_mode(PdfPathFillMode::Winding, true).unwrap();
        page.objects_mut().add_path_object(rect).unwrap();
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(8, 8, image::Rgba([0, 0, 255, 255])));
        let mut obj = PdfPageImageObject::new(&doc, &img).unwrap();
        obj.scale(60.0, 60.0).unwrap();
        obj.translate(PdfPoints::new(300.0), PdfPoints::new(200.0)).unwrap();
        page.objects_mut().add_image_object(obj).unwrap();
        let path = std::env::temp_dir().join(format!("folioscope-content-{name}-{}.pdf", std::process::id()));
        doc.save_to_file(&path).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn kinds(path: &str) -> Vec<PageObject> {
        list_page_objects(path.into(), 0).unwrap()
    }

    #[test]
    fn lists_text_image_and_shape() {
        let path = make_pdf("list");
        let objs = kinds(&path);
        let k: Vec<_> = objs.iter().map(|o| o.kind).collect();
        assert!(k.contains(&"text") && k.contains(&"shape") && k.contains(&"image"), "{k:?}");
        let t = objs.iter().find(|o| o.kind == "text").unwrap();
        assert_eq!(t.text.as_deref(), Some("Hello world"));
        assert!((t.size.unwrap() - 18.0).abs() < 0.1);
        let s = objs.iter().find(|o| o.kind == "shape").unwrap();
        assert_eq!(s.fill.as_deref(), Some("#FF0000"));
        assert!(t.rect.iter().all(|v| v.is_finite()) && t.rect[0] > 0.0 && t.rect[1] < 0.2, "chữ nằm gần đầu trang: {:?}", t.rect);
    }

    #[test]
    fn replaces_text_with_vietnamese_and_deletes_shape() {
        let path = make_pdf("text");
        let objs = kinds(&path);
        let t = objs.iter().find(|o| o.kind == "text").unwrap();
        let s = objs.iter().find(|o| o.kind == "shape").unwrap();
        let out = format!("{path}.out.pdf");
        let edits = vec![
            ObjEdit { id: t.id, text: Some("Xin chào Việt Nam".into()), ..Default::default() },
            ObjEdit { id: s.id, deleted: true, ..Default::default() },
        ];
        let r = save_content_edits(path.clone(), out.clone(), edits).unwrap();
        assert_eq!(r.applied, 2);
        let after = kinds(&out);
        let texts: Vec<_> = after.iter().filter_map(|o| o.text.clone()).collect();
        assert_eq!(texts, vec!["Xin chào Việt Nam".to_string()], "chữ cũ phải mất, chữ mới có dấu");
        assert!(after.iter().all(|o| o.kind != "shape"), "hình đã xoá");
        // Vị trí chữ mới trùng chữ cũ (cùng đường đáy, cùng mép trái).
        let nt = after.iter().find(|o| o.kind == "text").unwrap();
        assert!((nt.rect[0] - t.rect[0]).abs() < 0.01 && (nt.rect[1] - t.rect[1]).abs() < 0.02, "{:?} vs {:?}", nt.rect, t.rect);
    }

    #[test]
    fn moves_resizes_and_recolors_shape_and_image() {
        let path = make_pdf("move");
        let objs = kinds(&path);
        let s = objs.iter().find(|o| o.kind == "shape").unwrap();
        let i = objs.iter().find(|o| o.kind == "image").unwrap();
        let out = format!("{path}.out.pdf");
        let edits = vec![
            ObjEdit { id: s.id, rect: Some([0.5, 0.5, 0.2, 0.1]), fill: Some("#00FF00".into()), stroke: Some("none".into()), ..Default::default() },
            ObjEdit { id: i.id, rect: Some([0.1, 0.6, 0.15, 0.1]), ..Default::default() },
        ];
        save_content_edits(path, out.clone(), edits).unwrap();
        let after = kinds(&out);
        let s2 = after.iter().find(|o| o.kind == "shape").unwrap();
        assert_eq!(s2.fill.as_deref(), Some("#00FF00"));
        assert!(s2.stroke.is_none());
        for (got, want) in s2.rect.iter().zip([0.5, 0.5, 0.2, 0.1]) {
            assert!((got - want).abs() < 0.01, "{:?}", s2.rect);
        }
        let i2 = after.iter().find(|o| o.kind == "image").unwrap();
        for (got, want) in i2.rect.iter().zip([0.1, 0.6, 0.15, 0.1]) {
            assert!((got - want).abs() < 0.01, "{:?}", i2.rect);
        }
    }

    #[test]
    fn replaces_image_pixels() {
        let path = make_pdf("img");
        let i = kinds(&path).into_iter().find(|o| o.kind == "image").unwrap();
        let pic = std::env::temp_dir().join(format!("folioscope-content-pic-{}.png", std::process::id()));
        image::RgbaImage::from_pixel(4, 4, image::Rgba([0, 255, 0, 255])).save(&pic).unwrap();
        let out = format!("{path}.out.pdf");
        save_content_edits(path, out.clone(), vec![ObjEdit { id: i.id, image: Some(pic.to_string_lossy().into()), ..Default::default() }]).unwrap();
        let pdfium = bind().unwrap();
        let doc = pdfium.load_pdf_from_file(&out, None).unwrap();
        let page = doc.pages().get(0).unwrap();
        let obj = page.objects().iter().find(|o| o.as_image_object().is_some()).unwrap();
        let px = obj.as_image_object().unwrap().get_raw_image().unwrap().to_rgba8();
        assert_eq!(px.get_pixel(0, 0).0[1], 255, "ảnh mới màu xanh lá");
    }

    #[test]
    fn preview_render_matches_edit_and_reports_new_rects() {
        let path = make_pdf("preview");
        let t = kinds(&path).into_iter().find(|o| o.kind == "text").unwrap();
        let before = crate::pdf::render_page(path.clone(), 0, 300).unwrap();
        let edited = render_page_edited(path.clone(), 0, 300, vec![ObjEdit { id: t.id, text: Some("Một dòng dài hơn nhiều".into()), ..Default::default() }]).unwrap();
        assert_ne!(before.png_base64, edited.page.png_base64, "ảnh xem trước phải khác");
        assert_eq!(edited.rects.len(), 1);
        assert!(edited.rects[0].rect[2] > t.rect[2], "chữ dài hơn thì khung rộng hơn");
        // File gốc không bị đụng tới.
        assert_eq!(kinds(&path).into_iter().find(|o| o.kind == "text").unwrap().text.as_deref(), Some("Hello world"));
    }

    #[test]
    fn overwrite_keeps_backup() {
        let path = make_pdf("bak");
        let t = kinds(&path).into_iter().find(|o| o.kind == "text").unwrap();
        save_content_edits(path.clone(), path.clone(), vec![ObjEdit { id: t.id, text: Some("Mới".into()), ..Default::default() }]).unwrap();
        assert_eq!(kinds(&path).into_iter().find(|o| o.kind == "text").unwrap().text.as_deref(), Some("Mới"));
        let bak = crate::fsutil::backup_path(Path::new(&path));
        assert!(bak.exists(), "phải còn bản .bak");
    }
}
