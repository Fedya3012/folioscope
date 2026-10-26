//! Chuyển file không phải PDF sang PDF: ảnh bằng mã Rust, tài liệu văn phòng/văn bản/HTML bằng LibreOffice chạy ngầm.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use image::{ColorType, DynamicImage, ImageReader};
use lopdf::{dictionary, Document, Object, Stream};
use serde::Serialize;

use super::{file_err, CancelFlag, CombineError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Pdf,
    Image,
    /// Word, Excel, PowerPoint, văn bản, HTML: cần LibreOffice.
    Office,
    Unsupported,
}

pub fn classify(path: &Path) -> Kind {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "pdf" => Kind::Pdf,
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "tif" | "tiff" | "webp" => Kind::Image,
        "doc" | "docx" | "docm" | "odt" | "rtf" | "txt" | "html" | "htm" | "xls" | "xlsx" | "xlsm" | "ods" | "csv"
        | "ppt" | "pptx" | "pptm" | "odp" => Kind::Office,
        _ => Kind::Unsupported,
    }
}

/// Chuyển một file sang PDF trong `workdir` và trả đường dẫn PDF mới.
pub fn to_pdf(src: &Path, workdir: &Path, office: Option<&Path>, cancel: &CancelFlag) -> Result<PathBuf, CombineError> {
    match classify(src) {
        Kind::Pdf => Ok(src.to_path_buf()),
        Kind::Image => image_to_pdf(src, workdir),
        Kind::Office => {
            let soffice = office.ok_or_else(|| {
                file_err(src, "cần cài LibreOffice để chuyển Word, Excel, PowerPoint, văn bản và HTML sang PDF")
            })?;
            office_to_pdf(src, workdir, soffice, cancel)
        }
        Kind::Unsupported => Err(file_err(src, "định dạng này chưa được hỗ trợ")),
    }
}

/// Tìm LibreOffice: biến môi trường, thư mục cài mặc định của Windows/macOS/Linux, rồi PATH.
pub fn find_office() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("FOLIOSCOPE_SOFFICE") {
        let p = PathBuf::from(p);
        if p.is_file() { return Some(p); }
    }
    let fixed = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice",
        "/usr/local/bin/soffice",
    ];
    if let Some(p) = fixed.iter().map(PathBuf::from).find(|p| p.is_file()) { return Some(p); }
    let exe = if cfg!(windows) { "soffice.exe" } else { "soffice" };
    let on_path = std::env::var_os("PATH")
        .and_then(|paths| std::env::split_paths(&paths).map(|d| d.join(exe)).find(|p| p.is_file()));
    // Bản app tự tải về (xem office_install) đứng cuối: máy đã có LibreOffice thì dùng bản đó.
    on_path.or_else(crate::office_install::find_managed)
}

const OFFICE_TIMEOUT: Duration = Duration::from_secs(300);

fn office_to_pdf(src: &Path, workdir: &Path, soffice: &Path, cancel: &CancelFlag) -> Result<PathBuf, CombineError> {
    run_office(src, workdir, soffice, cancel, None, "pdf")
}

/// Bộ lọc xuất PDF/A-2b theo loại file nguồn (LibreOffice cần đúng tên bộ lọc để nhận tuỳ chọn).
pub fn pdfa_target(src: &Path) -> &'static str {
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "xls" | "xlsx" | "xlsm" | "ods" | "csv" => r#"pdf:calc_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}"#,
        "ppt" | "pptx" | "pptm" | "odp" => r#"pdf:impress_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}"#,
        // PDF nạp lại bằng Draw cũng xuất bằng bộ lọc Draw.
        "pdf" => r#"pdf:draw_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}"#,
        _ => r#"pdf:writer_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}"#,
    }
}

/// Chạy LibreOffice ngầm: `infilter` chọn bộ nhập (ví dụ đọc PDF như tài liệu Writer), `target` là đối số của `--convert-to`.
/// Phần trước dấu `:` đầu tiên của `target` là đuôi file kết quả.
pub fn run_office(
    src: &Path,
    workdir: &Path,
    soffice: &Path,
    cancel: &CancelFlag,
    infilter: Option<&str>,
    target: &str,
) -> Result<PathBuf, CombineError> {
    // Mỗi lần chuyển dùng thư mục riêng và hồ sơ người dùng riêng: tránh khoá khi LibreOffice đang mở sẵn trên máy.
    let out_dir = workdir.join(format!("out-{}", unique()));
    let profile = workdir.join(format!("profile-{}", unique()));
    std::fs::create_dir_all(&out_dir).map_err(|e| file_err(src, e))?;

    let mut cmd = Command::new(soffice);
    cmd.args(["--headless", "--norestore", "--nolockcheck", "--nodefault", "--nologo"])
        .arg(format!("-env:UserInstallation={}", file_url(&profile)));
    if let Some(f) = infilter {
        cmd.arg(format!("--infilter={f}"));
    }
    cmd.args(["--convert-to", target, "--outdir"])
        .arg(&out_dir)
        .arg(src)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| file_err(src, format!("không chạy được LibreOffice ({e})")))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(status)) => return Err(file_err(src, format!("LibreOffice báo lỗi ({status})"))),
            Ok(None) => {}
            Err(e) => return Err(file_err(src, e)),
        }
        if cancel.check().is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CombineError::Cancelled);
        }
        if start.elapsed() > OFFICE_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(file_err(src, "chuyển đổi quá lâu (hơn 5 phút)"));
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let ext = target.split(':').next().unwrap_or("pdf");
    let stem = src.file_stem().unwrap_or_default();
    let out = out_dir.join(stem).with_extension(ext);
    if out.is_file() { Ok(out) } else { Err(file_err(src, "LibreOffice không tạo ra file kết quả")) }
}

pub fn unique() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    N.fetch_add(1, Ordering::SeqCst)
}

fn file_url(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    if s.starts_with('/') { format!("file://{s}") } else { format!("file:///{s}") }
}

#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
pub fn hide_console(_: &mut Command) {}

/// Khổ A4 theo điểm PDF; ảnh lớn hơn được thu nhỏ vừa khổ này (giữ tỉ lệ), ảnh nhỏ giữ nguyên cỡ ở 96 dpi.
const A4: (f32, f32) = (595.0, 842.0);

fn image_to_pdf(src: &Path, workdir: &Path) -> Result<PathBuf, CombineError> {
    let bytes = std::fs::read(src).map_err(|e| file_err(src, e))?;
    let reader = ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| file_err(src, e))?;
    let is_jpeg = reader.format() == Some(image::ImageFormat::Jpeg);
    let img = reader.decode().map_err(|e| file_err(src, format!("không đọc được ảnh ({e})")))?;
    let (w, h) = (img.width(), img.height());

    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();

    let mut dict = dictionary! {
        "Type" => "XObject", "Subtype" => "Image",
        "Width" => w as i64, "Height" => h as i64, "BitsPerComponent" => 8,
    };
    let stream = match (&img, is_jpeg) {
        // JPEG RGB/xám nhúng nguyên bản, không mã hoá lại nên không mất chất lượng.
        (DynamicImage::ImageRgb8(_) | DynamicImage::ImageLuma8(_), true) => {
            dict.set("ColorSpace", if img.color() == ColorType::L8 { "DeviceGray" } else { "DeviceRGB" });
            dict.set("Filter", "DCTDecode");
            Stream::new(dict, bytes).with_compression(false)
        }
        _ => {
            let (space, data, alpha) = if img.color().has_alpha() {
                let rgba = img.to_rgba8();
                let rgb: Vec<u8> = rgba.pixels().flat_map(|p| [p[0], p[1], p[2]]).collect();
                let a: Vec<u8> = rgba.pixels().map(|p| p[3]).collect();
                ("DeviceRGB", rgb, Some(a))
            } else if matches!(img.color(), ColorType::L8 | ColorType::L16) {
                ("DeviceGray", img.to_luma8().into_raw(), None)
            } else {
                ("DeviceRGB", img.to_rgb8().into_raw(), None)
            };
            dict.set("ColorSpace", space);
            if let Some(a) = alpha {
                let mut mask = Stream::new(
                    dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
                                  "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8 },
                    a,
                );
                let _ = mask.compress();
                dict.set("SMask", doc.add_object(mask));
            }
            let mut s = Stream::new(dict, data);
            let _ = s.compress();
            s
        }
    };
    let image_id = doc.add_object(stream);

    let (mut pw, mut ph) = (w as f32 * 0.75, h as f32 * 0.75);
    let bound = if pw > ph { (A4.1, A4.0) } else { A4 };
    let scale = (bound.0 / pw).min(bound.1 / ph).min(1.0);
    (pw, ph) = (pw * scale, ph * scale);

    let content = format!("q {pw:.3} 0 0 {ph:.3} 0 0 cm /Im0 Do Q").into_bytes();
    let content_id = doc.add_object(Stream::new(dictionary! {}, content));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), Object::Real(pw), Object::Real(ph)],
        "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => image_id } },
        "Contents" => content_id,
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);

    let out = workdir.join(format!("img-{}.pdf", unique()));
    doc.save(&out).map_err(|e| file_err(src, e))?;
    Ok(out)
}
