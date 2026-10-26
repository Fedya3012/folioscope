//! OCR bằng Tesseract: ảnh hoặc PDF quét thành PDF tìm kiếm được (ảnh nền + lớp chữ vô hình).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use image::{DynamicImage, ImageFormat};

use crate::combine::convert::{hide_console, unique};
use crate::combine::{file_err, merge, CancelFlag, CombineError};

/// Độ phân giải dựng trang PDF để nhận dạng. 300 dpi là mức Tesseract đọc tốt nhất.
const RENDER_DPI: f32 = 300.0;

pub struct Ocr {
    exe: PathBuf,
    tessdata: Option<PathBuf>,
    lang: String,
}

/// Chuẩn hoá chuỗi ngôn ngữ ("vie+eng", "vie, eng") thành danh sách mã Tesseract.
pub fn parse_langs(lang: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for l in lang.split(|c: char| c == '+' || c == ',' || c.is_whitespace()).filter(|l| !l.is_empty()) {
        if !out.iter().any(|x| x == l) { out.push(l.to_string()); }
    }
    out
}

impl Ocr {
    /// Chuẩn bị Tesseract và dữ liệu ngôn ngữ (tải nếu thiếu).
    pub fn prepare(lang: &str, cancel: &CancelFlag) -> Result<Ocr, String> {
        let exe = crate::ocr_install::find().ok_or("OCR_MISSING")?;
        let langs = parse_langs(lang);
        if langs.is_empty() {
            return Err("chưa chọn ngôn ngữ nhận dạng".into());
        }
        let tessdata = crate::ocr_install::ensure_langs(&exe, &langs, cancel)?;
        Ok(Ocr { exe, tessdata, lang: langs.join("+") })
    }

    /// Nhận dạng một ảnh thành PDF một trang tại `out_pdf`. `dpi` quyết định cỡ trang kết quả.
    fn recognize(&self, image: &Path, out_pdf: &Path, dpi: u32, cancel: &CancelFlag) -> Result<(), CombineError> {
        let base = out_pdf.with_extension("");
        let mut cmd = Command::new(&self.exe);
        cmd.arg(image).arg(&base).args(["-l", &self.lang, "--dpi", &dpi.to_string()]);
        if let Some(d) = &self.tessdata {
            cmd.arg("--tessdata-dir").arg(d);
        }
        cmd.arg("pdf").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        hide_console(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| file_err(image, format!("không chạy được Tesseract ({e})")))?;
        loop {
            match child.try_wait() {
                Ok(Some(st)) if st.success() => break,
                Ok(Some(st)) => {
                    let mut err = String::new();
                    if let Some(mut s) = child.stderr.take() { let _ = std::io::Read::read_to_string(&mut s, &mut err); }
                    let detail = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
                    return Err(file_err(image, format!("Tesseract báo lỗi ({st}) {detail}")));
                }
                Ok(None) => {}
                Err(e) => return Err(file_err(image, e)),
            }
            if cancel.check().is_err() {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CombineError::Cancelled);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        if out_pdf.is_file() { Ok(()) } else { Err(file_err(image, "Tesseract không tạo ra file PDF")) }
    }

    /// Ảnh (JPG, PNG, TIFF, BMP, GIF, WebP) thành PDF tìm kiếm được, vừa khổ A4 theo tỉ lệ ảnh.
    pub fn image_to_pdf(&self, src: &Path, workdir: &Path, cancel: &CancelFlag) -> Result<PathBuf, CombineError> {
        let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let (input, dims) = if matches!(ext.as_str(), "jpg" | "jpeg" | "png") {
            let (w, h) = image::image_dimensions(src).map_err(|e| file_err(src, format!("không đọc được ảnh ({e})")))?;
            (src.to_path_buf(), (w, h))
        } else {
            let img = image::open(src).map_err(|e| file_err(src, format!("không đọc được ảnh ({e})")))?;
            let png = workdir.join(format!("ocr-in-{}.png", unique()));
            let rgb = DynamicImage::ImageRgb8(img.to_rgb8());
            rgb.save_with_format(&png, ImageFormat::Png).map_err(|e| file_err(src, e))?;
            (png, (rgb.width(), rgb.height()))
        };
        // Chọn dpi sao cho trang kết quả vừa khổ A4 (8,27 x 11,69 inch), không nhỏ hơn 70.
        let long = dims.0.max(dims.1) as f32;
        let short = dims.0.min(dims.1) as f32;
        let dpi = (long / 11.69).max(short / 8.27).ceil().clamp(70.0, 600.0) as u32;
        let out = workdir.join(format!("ocr-{}.pdf", unique()));
        self.recognize(&input, &out, dpi, cancel).map_err(|e| match e {
            CombineError::File { reason, .. } => file_err(src, reason),
            other => other,
        })?;
        Ok(out)
    }

    /// PDF (thường là bản quét) thành PDF tìm kiếm được: dựng từng trang, nhận dạng, ghép lại.
    /// `on_page(i, tổng)` được gọi trước mỗi trang.
    pub fn pdf_to_pdf(
        &self,
        src: &Path,
        out: &Path,
        workdir: &Path,
        cancel: &CancelFlag,
        on_page: &mut dyn FnMut(usize, usize),
    ) -> Result<usize, CombineError> {
        use pdfium_render::prelude::*;
        let pdfium = crate::pdf::bind().map_err(|e| file_err(src, e))?;
        let doc = crate::pdf::load(pdfium, &src.to_string_lossy()).map_err(|e| file_err(src, e))?;
        let total = doc.pages().len() as usize;
        let mut parts = Vec::with_capacity(total);
        for i in 0..total {
            cancel.check()?;
            on_page(i, total);
            let page = doc.pages().get(i as i32).map_err(|e| file_err(src, e))?;
            let width = (page.width().value / 72.0 * RENDER_DPI).round().max(1.0) as i32;
            let img = page
                .render_with_config(&PdfRenderConfig::new().set_target_width(width))
                .and_then(|b| b.as_image())
                .map_err(|e| file_err(src, format!("không dựng được trang {}: {e}", i + 1)))?;
            let jpg = workdir.join(format!("page-{}.jpg", unique()));
            let mut file = std::io::BufWriter::new(std::fs::File::create(&jpg).map_err(|e| file_err(src, e))?);
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 85);
            enc.encode_image(&DynamicImage::ImageRgb8(img.to_rgb8())).map_err(|e| file_err(src, e))?;
            drop(file);
            let page_pdf = workdir.join(format!("page-{}.pdf", unique()));
            self.recognize(&jpg, &page_pdf, RENDER_DPI as u32, cancel).map_err(|e| match e {
                CombineError::File { reason, .. } => file_err(src, format!("trang {}: {reason}", i + 1)),
                other => other,
            })?;
            let _ = std::fs::remove_file(&jpg);
            parts.push(merge::load(&page_pdf, None).map_err(|e| file_err(src, e))?);
        }
        let titles: Vec<Option<&str>> = vec![None; parts.len()];
        let mut merged = merge::merge(parts, &titles, false)?;
        crate::combine::optimize::apply(&mut merged, crate::combine::Compression::Balanced);
        crate::combine::write_atomic(&mut merged, out, true)?;
        Ok(total)
    }
}
