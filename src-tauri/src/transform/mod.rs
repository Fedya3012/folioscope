//! Màn hình "Chuyển đổi": Word/Excel/PowerPoint/ảnh sang PDF (kể cả PDF/A), PDF sang Word/Excel/PowerPoint/ảnh/văn bản/HTML,
//! và OCR (ảnh hoặc PDF quét thành PDF tìm kiếm được). Phần lõi không phụ thuộc Tauri nên kiểm thử được.

pub mod ocr;
pub mod xlsx;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::combine::convert::{self, Kind};
use crate::combine::{file_err, tempdir, CancelFlag, CombineError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Target {
    /// Word, Excel, PowerPoint, văn bản, HTML, ảnh sang PDF; PDF sang PDF/A khi bật `pdfa`.
    ToPdf,
    Docx,
    Xlsx,
    Pptx,
    Png,
    Jpg,
    Txt,
    Html,
    /// Nhận dạng chữ: ảnh hoặc PDF quét thành PDF tìm kiếm được.
    Ocr,
}

impl Target {
    pub fn ext(self) -> &'static str {
        match self {
            Target::ToPdf | Target::Ocr => "pdf",
            Target::Docx => "docx",
            Target::Xlsx => "xlsx",
            Target::Pptx => "pptx",
            Target::Png => "png",
            Target::Jpg => "jpg",
            Target::Txt => "txt",
            Target::Html => "html",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    pub files: Vec<PathBuf>,
    pub out_dir: PathBuf,
    pub target: Target,
    /// Xuất PDF/A-2b (lưu trữ lâu dài). Chỉ dùng với `to_pdf`.
    #[serde(default)]
    pub pdfa: bool,
    /// Ngôn ngữ OCR, ví dụ "vie+eng".
    #[serde(default = "default_lang")]
    pub lang: String,
    /// Độ phân giải khi xuất trang PDF thành ảnh.
    #[serde(default = "default_dpi")]
    pub dpi: u32,
}

fn default_lang() -> String { "vie+eng".into() }
fn default_dpi() -> u32 { 200 }

#[derive(Debug, Clone, Serialize)]
pub struct ItemResult {
    pub input: PathBuf,
    pub outputs: Vec<PathBuf>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub current: usize,
    pub total: usize,
    pub file: Option<String>,
    /// 0..=100 cho cả đợt.
    pub percent: f32,
    /// Việc đang làm trong file hiện tại, ví dụ "Trang 3 / 12".
    pub detail: Option<String>,
}

/// Tên file chưa tồn tại: `ten.ext`, rồi `ten (2).ext`, `ten (3).ext`...
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() { return first; }
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}).{ext}")))
        .find(|p| !p.exists())
        .expect("vô hạn")
}

fn stem_of(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "tai-lieu".into())
}

/// Đưa file kết quả (đang ở thư mục tạm) về `out_dir` với tên không trùng.
fn deliver(tmp_file: &Path, out_dir: &Path, stem: &str, ext: &str) -> Result<PathBuf, CombineError> {
    let dest = unique_path(out_dir, stem, ext);
    // Đổi tên không chạy được giữa hai ổ đĩa khác nhau, nên sao chép rồi xoá.
    std::fs::copy(tmp_file, &dest).map_err(|e| CombineError::Write(format!("{}: {e}", dest.display())))?;
    let _ = std::fs::remove_file(tmp_file);
    Ok(dest)
}

/// Việc nào cần LibreOffice / Tesseract, để giao diện mời cài trước khi chạy.
pub fn needs_office(req: &Request) -> bool {
    match req.target {
        Target::Docx | Target::Pptx => true,
        Target::ToPdf => req.pdfa || req.files.iter().any(|f| convert::classify(f) == Kind::Office),
        _ => false,
    }
}

pub fn needs_ocr(req: &Request) -> bool { req.target == Target::Ocr }

pub fn run(
    req: &Request,
    cancel: &CancelFlag,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<Vec<ItemResult>, String> {
    if req.files.is_empty() { return Err("chưa chọn file nào".into()); }
    std::fs::create_dir_all(&req.out_dir).map_err(|e| format!("không tạo được thư mục {}: {e}", req.out_dir.display()))?;
    let office = convert::find_office();
    if needs_office(req) && office.is_none() { return Err("OFFICE_MISSING".into()); }
    let ocr = if needs_ocr(req) { Some(ocr::Ocr::prepare(&req.lang, cancel)?) } else { None };

    let n = req.files.len();
    let mut results = Vec::with_capacity(n);
    for (i, src) in req.files.iter().enumerate() {
        let name = src.file_name().map(|s| s.to_string_lossy().into_owned());
        let report = |on: &mut dyn FnMut(Progress), frac: f32, detail: Option<String>| {
            on(Progress { current: i, total: n, file: name.clone(), percent: (i as f32 + frac) / n as f32 * 100.0, detail });
        };
        report(on_progress, 0.0, None);
        if cancel.check().is_err() { return Err("đã huỷ".into()); }
        let tmp = tempdir().map_err(|e| e.to_string())?;
        let outcome = convert_one(req, src, tmp.path(), office.as_deref(), ocr.as_ref(), cancel, &mut |frac, detail| {
            report(on_progress, frac, detail);
        });
        match outcome {
            Err(CombineError::Cancelled) => return Err("đã huỷ".into()),
            Err(e) => results.push(ItemResult { input: src.clone(), outputs: vec![], error: Some(e.to_string()) }),
            Ok(outputs) => results.push(ItemResult { input: src.clone(), outputs, error: None }),
        }
    }
    on_progress(Progress { current: n, total: n, file: None, percent: 100.0, detail: None });
    Ok(results)
}

fn convert_one(
    req: &Request,
    src: &Path,
    tmp: &Path,
    office: Option<&Path>,
    ocr: Option<&ocr::Ocr>,
    cancel: &CancelFlag,
    progress: &mut dyn FnMut(f32, Option<String>),
) -> Result<Vec<PathBuf>, CombineError> {
    let kind = convert::classify(src);
    let stem = stem_of(src);
    let out_dir = req.out_dir.as_path();
    let soffice = || office.ok_or_else(|| file_err(src, "cần cài LibreOffice"));
    let need_pdf = || {
        if kind == Kind::Pdf { Ok(()) } else { Err(file_err(src, "chỉ chuyển được từ file PDF")) }
    };

    match req.target {
        Target::ToPdf => {
            let produced = match kind {
                Kind::Unsupported => return Err(file_err(src, "định dạng này chưa được hỗ trợ")),
                Kind::Pdf if !req.pdfa => return Err(file_err(src, "đã là PDF (bật PDF/A nếu muốn chuyển sang PDF/A)")),
                Kind::Pdf => convert::run_office(src, tmp, soffice()?, cancel, Some("draw_pdf_import"), convert::pdfa_target(src))?,
                Kind::Image if req.pdfa => {
                    let pdf = convert::to_pdf(src, tmp, None, cancel)?;
                    convert::run_office(&pdf, tmp, soffice()?, cancel, Some("draw_pdf_import"), convert::pdfa_target(&pdf))?
                }
                Kind::Image => convert::to_pdf(src, tmp, None, cancel)?,
                Kind::Office if req.pdfa => convert::run_office(src, tmp, soffice()?, cancel, None, convert::pdfa_target(src))?,
                Kind::Office => convert::to_pdf(src, tmp, office, cancel)?,
            };
            Ok(vec![deliver(&produced, out_dir, &stem, "pdf")?])
        }
        Target::Docx => {
            need_pdf()?;
            let f = convert::run_office(src, tmp, soffice()?, cancel, Some("writer_pdf_import"), "docx:MS Word 2007 XML")?;
            Ok(vec![deliver(&f, out_dir, &stem, "docx")?])
        }
        Target::Pptx => {
            need_pdf()?;
            let f = convert::run_office(src, tmp, soffice()?, cancel, Some("impress_pdf_import"), "pptx:Impress MS PowerPoint 2007 XML")?;
            Ok(vec![deliver(&f, out_dir, &stem, "pptx")?])
        }
        Target::Xlsx => {
            need_pdf()?;
            let out = tmp.join("out.xlsx");
            let sheets = pdf_pages(src, cancel, progress, |page| {
                let glyphs = page_glyphs(page)?;
                Ok(xlsx::to_grid(&xlsx::lines_of_cells(&glyphs), 6.0))
            })?;
            xlsx::write_xlsx(&out, &sheets).map_err(|e| file_err(src, e))?;
            Ok(vec![deliver(&out, out_dir, &stem, "xlsx")?])
        }
        Target::Txt | Target::Html => {
            need_pdf()?;
            let pages = pdf_pages(src, cancel, progress, page_text)?;
            let (body, ext) = if req.target == Target::Txt {
                (pages.join("\n\n"), "txt")
            } else {
                (html_document(&stem, &pages), "html")
            };
            let out = tmp.join(format!("out.{ext}"));
            std::fs::write(&out, body).map_err(|e| file_err(src, e))?;
            Ok(vec![deliver(&out, out_dir, &stem, ext)?])
        }
        Target::Png | Target::Jpg => {
            need_pdf()?;
            render_images(src, out_dir, &stem, req.target, req.dpi.clamp(72, 600), cancel, progress)
        }
        Target::Ocr => {
            let ocr = ocr.ok_or_else(|| file_err(src, "chưa sẵn sàng Tesseract"))?;
            let produced = match kind {
                Kind::Image => ocr.image_to_pdf(src, tmp, cancel)?,
                Kind::Pdf => {
                    let out = tmp.join("ocr-out.pdf");
                    ocr.pdf_to_pdf(src, &out, tmp, cancel, &mut |i, total| {
                        progress(i as f32 / total.max(1) as f32, Some(format!("Trang {} / {}", i + 1, total)));
                    })?;
                    out
                }
                _ => return Err(file_err(src, "OCR chỉ dùng cho ảnh và PDF")),
            };
            Ok(vec![deliver(&produced, out_dir, &format!("{stem}-ocr"), "pdf")?])
        }
    }
}

use pdfium_render::prelude::*;

/// Chạy `f` cho từng trang của PDF và gom kết quả; báo tiến trình theo trang.
fn pdf_pages<T>(
    src: &Path,
    cancel: &CancelFlag,
    progress: &mut dyn FnMut(f32, Option<String>),
    mut f: impl FnMut(&PdfPage) -> Result<T, CombineError>,
) -> Result<Vec<T>, CombineError> {
    let pdfium = crate::pdf::bind().map_err(|e| file_err(src, e))?;
    let doc = crate::pdf::load(pdfium, &src.to_string_lossy()).map_err(|e| file_err(src, e))?;
    let total = doc.pages().len() as usize;
    let mut out = Vec::with_capacity(total);
    for i in 0..total {
        cancel.check()?;
        progress(i as f32 / total.max(1) as f32, Some(format!("Trang {} / {}", i + 1, total)));
        let page = doc.pages().get(i as i32).map_err(|e| file_err(src, e))?;
        out.push(f(&page)?);
    }
    Ok(out)
}

fn page_glyphs(page: &PdfPage) -> Result<Vec<xlsx::Glyph>, CombineError> {
    let text = page.text().map_err(|e| CombineError::Write(e.to_string()))?;
    Ok(text
        .chars()
        .iter()
        .filter_map(|ch| {
            let c = ch.unicode_char()?;
            let b = ch.loose_bounds().ok()?;
            Some(xlsx::Glyph { c, left: b.left().value, right: b.right().value, bottom: b.bottom().value, top: b.top().value })
        })
        .collect())
}

fn page_text(page: &PdfPage) -> Result<String, CombineError> {
    let text = page.text().map_err(|e| CombineError::Write(e.to_string()))?;
    Ok(text.all().replace("\r\n", "\n").replace('\r', "\n").trim_end().to_string())
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn html_document(title: &str, pages: &[String]) -> String {
    let mut h = format!(
        "<!DOCTYPE html>\n<html lang=\"vi\">\n<head>\n<meta charset=\"utf-8\">\n<title>{}</title>\n<style>body{{font-family:sans-serif;max-width:46em;margin:2em auto;line-height:1.5}}section{{margin-bottom:2em;border-bottom:1px solid #ccc}}</style>\n</head>\n<body>\n",
        html_escape(title)
    );
    for (i, text) in pages.iter().enumerate() {
        h.push_str(&format!("<section id=\"trang-{}\">\n", i + 1));
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            h.push_str(&format!("<p>{}</p>\n", html_escape(line.trim())));
        }
        h.push_str("</section>\n");
    }
    h.push_str("</body>\n</html>\n");
    h
}

/// Xuất mỗi trang thành một ảnh trong thư mục `ten-file` (tạo mới nếu trùng tên).
fn render_images(
    src: &Path,
    out_dir: &Path,
    stem: &str,
    target: Target,
    dpi: u32,
    cancel: &CancelFlag,
    progress: &mut dyn FnMut(f32, Option<String>),
) -> Result<Vec<PathBuf>, CombineError> {
    let folder = std::iter::once(out_dir.join(stem))
        .chain((2..).map(|n| out_dir.join(format!("{stem} ({n})"))))
        .find(|p| !p.exists())
        .expect("vô hạn");
    std::fs::create_dir_all(&folder).map_err(|e| CombineError::Write(format!("{}: {e}", folder.display())))?;
    let mut written = Vec::new();
    let res = pdf_pages(src, cancel, progress, |page| {
        let width = (page.width().value / 72.0 * dpi as f32).round().max(1.0) as i32;
        let img = page
            .render_with_config(&PdfRenderConfig::new().set_target_width(width))
            .and_then(|b| b.as_image())
            .map_err(|e| file_err(src, format!("không dựng được trang: {e}")))?;
        let path = folder.join(format!("{stem}-{:03}.{}", written.len() + 1, target.ext()));
        if target == Target::Jpg {
            let rgb = image::DynamicImage::ImageRgb8(img.to_rgb8());
            let file = std::fs::File::create(&path).map_err(|e| file_err(src, e))?;
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 90);
            enc.encode_image(&rgb).map_err(|e| file_err(src, e))?;
        } else {
            img.save_with_format(&path, image::ImageFormat::Png).map_err(|e| file_err(src, e))?;
        }
        written.push(path);
        Ok(())
    });
    if let Err(e) = res {
        let _ = std::fs::remove_dir_all(&folder);
        return Err(e);
    }
    Ok(written)
}

#[cfg(test)]
mod tests;
