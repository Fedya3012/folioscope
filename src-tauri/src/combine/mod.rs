//! Gộp nhiều file thành một PDF. Phần lõi (đọc, chuyển đổi, gộp, nén) không phụ thuộc Tauri nên kiểm thử được trên mọi hệ điều hành.

pub mod convert;
pub mod merge;
pub mod normalize;
pub mod optimize;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum CombineError {
    #[error("đã huỷ")]
    Cancelled,
    #[error("{file}: {reason}")]
    File { file: String, reason: String },
    #[error("chưa có file nào để gộp")]
    NoInput,
    #[error("file kết quả trùng với một file nguồn, hãy chọn tên khác")]
    OutputIsInput,
    #[error("không ghi được file kết quả: {0}")]
    Write(String),
}

impl Serialize for CombineError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub fn file_err(path: &std::path::Path, reason: impl ToString) -> CombineError {
    CombineError::File {
        file: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        reason: reason.to_string(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Compression {
    /// Giữ nguyên, chỉ ghép trang.
    None,
    /// Nén luồng dữ liệu và gộp đối tượng, không đổi chất lượng ảnh.
    Balanced,
    /// Như Balanced, thêm giảm độ phân giải ảnh JPEG lớn.
    Max,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InputFile {
    pub path: PathBuf,
    /// Tiêu đề dấu trang cho file này; rỗng thì không tạo dấu trang riêng.
    pub title: String,
    /// Mật khẩu mở file PDF có khoá.
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CombineRequest {
    pub files: Vec<InputFile>,
    pub output: PathBuf,
    pub bookmarks: bool,
    /// Giữ dấu trang gốc của từng PDF.
    #[serde(default)]
    pub keep_bookmarks: bool,
    /// Đưa mọi trang về khổ A4 (co vừa, giữ tỉ lệ, theo hướng dọc/ngang của trang).
    #[serde(default)]
    pub normalize_a4: bool,
    pub compression: Compression,
    /// Nhận dạng chữ (OCR) cho file ảnh để PDF kết quả tìm kiếm được.
    #[serde(default)]
    pub ocr_images: bool,
    /// Ngôn ngữ OCR, ví dụ "vie+eng".
    #[serde(default = "default_ocr_lang")]
    pub ocr_lang: String,
}

fn default_ocr_lang() -> String { "vie+eng".into() }

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    /// "convert" | "merge" | "optimize" | "write"
    pub stage: &'static str,
    pub current: usize,
    pub total: usize,
    pub file: Option<String>,
    /// 0..=100 cho cả tiến trình.
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CombineResult {
    pub output: PathBuf,
    pub pages: usize,
    pub bytes: u64,
    /// File đã được chuyển sang PDF trước khi gộp.
    pub converted: usize,
}

/// Cờ huỷ dùng chung giữa nút "Huỷ" và luồng đang gộp.
#[derive(Debug, Default)]
pub struct CancelFlag(AtomicBool);

impl CancelFlag {
    pub fn cancel(&self) { self.0.store(true, Ordering::SeqCst); }
    pub fn reset(&self) { self.0.store(false, Ordering::SeqCst); }
    pub fn check(&self) -> Result<(), CombineError> {
        if self.0.load(Ordering::SeqCst) { Err(CombineError::Cancelled) } else { Ok(()) }
    }
}

/// Chạy toàn bộ quy trình: chuyển đổi file không phải PDF, gộp, nén, ghi.
pub fn combine(
    req: &CombineRequest,
    office: Option<&std::path::Path>,
    cancel: &CancelFlag,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<CombineResult, CombineError> {
    if req.files.is_empty() { return Err(CombineError::NoInput); }
    if req.files.iter().any(|f| same_file(&f.path, &req.output)) { return Err(CombineError::OutputIsInput); }

    let n = req.files.len();
    // Phần trăm: chuyển đổi 0-50, gộp 50-80, nén 80-95, ghi 95-100.
    let tmp = tempdir()?;
    let mut docs = Vec::with_capacity(n);
    let mut converted = 0;
    let ocr = if req.ocr_images && req.files.iter().any(|f| convert::classify(&f.path) == convert::Kind::Image) {
        Some(crate::transform::ocr::Ocr::prepare(&req.ocr_lang, cancel).map_err(|e| CombineError::File { file: String::new(), reason: e })?)
    } else {
        None
    };
    for (i, f) in req.files.iter().enumerate() {
        cancel.check()?;
        let name = f.path.file_name().map(|s| s.to_string_lossy().into_owned());
        on_progress(Progress { stage: "convert", current: i, total: n, file: name.clone(), percent: 50.0 * i as f32 / n as f32 });
        let pdf_path = match convert::classify(&f.path) {
            convert::Kind::Pdf => f.path.clone(),
            convert::Kind::Unsupported => return Err(file_err(&f.path, "định dạng này chưa được hỗ trợ")),
            convert::Kind::Image if ocr.is_some() => {
                converted += 1;
                ocr.as_ref().expect("đã kiểm tra").image_to_pdf(&f.path, tmp.path(), cancel)?
            }
            _ => { converted += 1; convert::to_pdf(&f.path, tmp.path(), office, cancel)? }
        };
        docs.push(merge::load(&pdf_path, f.password.as_deref()).map_err(|e| file_err(&f.path, e))?);
    }
    cancel.check()?;
    on_progress(Progress { stage: "merge", current: n, total: n, file: None, percent: 50.0 });
    let titles: Vec<Option<&str>> = req.files.iter().map(|f| (req.bookmarks && !f.title.trim().is_empty()).then_some(f.title.as_str())).collect();
    let mut merged = merge::merge(docs, &titles, req.keep_bookmarks)?;
    let pages = merged.get_pages().len();
    if req.normalize_a4 { normalize::normalize_a4(&mut merged); }

    cancel.check()?;
    on_progress(Progress { stage: "optimize", current: 0, total: 1, file: None, percent: 80.0 });
    optimize::apply(&mut merged, req.compression);

    cancel.check()?;
    on_progress(Progress { stage: "write", current: 0, total: 1, file: None, percent: 95.0 });
    let bytes = write_atomic(&mut merged, &req.output, req.compression != Compression::None)?;
    on_progress(Progress { stage: "write", current: 1, total: 1, file: None, percent: 100.0 });
    Ok(CombineResult { output: req.output.clone(), pages, bytes, converted })
}

fn same_file(a: &std::path::Path, b: &std::path::Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Ghi ra file tạm cạnh đích rồi đổi tên, để lỗi giữa chừng không làm hỏng file đích cũ.
pub(crate) fn write_atomic(doc: &mut lopdf::Document, out: &std::path::Path, modern: bool) -> Result<u64, CombineError> {
    let tmp = out.with_extension("pdf.part");
    let res = (|| -> std::io::Result<()> {
        let mut f = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
        if modern { doc.save_modern(&mut f).map_err(std::io::Error::other)?; } else { doc.save_to(&mut f)?; }
        std::io::Write::flush(&mut f)?;
        drop(f);
        crate::fsutil::commit_tmp(&tmp, out, true)
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_file(&tmp);
        return Err(CombineError::Write(e.to_string()));
    }
    std::fs::metadata(out).map(|m| m.len()).map_err(|e| CombineError::Write(e.to_string()))
}

pub struct TempDir(PathBuf);
impl TempDir { pub fn path(&self) -> &std::path::Path { &self.0 } }
impl Drop for TempDir { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

pub fn tempdir() -> Result<TempDir, CombineError> {
    use std::sync::atomic::AtomicU64;
    static N: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!("folioscope-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).map_err(|e| CombineError::Write(e.to_string()))?;
    Ok(TempDir(dir))
}

#[cfg(test)]
mod tests;
