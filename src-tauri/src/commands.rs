//! Lệnh Tauri cho tính năng Gộp file. Việc nặng chạy trên luồng riêng để giao diện không bị đứng.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::combine::{self, convert, CancelFlag, CombineError, CombineRequest, CombineResult};

#[derive(Serialize)]
pub struct FileProbe {
    pub path: PathBuf,
    pub name: String,
    pub kind: convert::Kind,
    pub size: u64,
    /// Số trang nếu là PDF đọc được.
    pub pages: Option<usize>,
    pub error: Option<String>,
    /// File PDF có mật khẩu (chưa nhập hoặc nhập sai): giao diện hiện ô nhập ngay trong hàng.
    pub needs_password: bool,
}

fn probe(path: PathBuf, password: Option<&str>) -> FileProbe {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let kind = convert::classify(&path);
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let mut needs_password = false;
    let (pages, error) = match kind {
        convert::Kind::Pdf => match combine::merge::load(&path, password) {
            Ok(d) => (Some(d.get_pages().len()), None),
            Err(e) => {
                needs_password = matches!(e, combine::merge::LoadError::Password { .. });
                (None, Some(e.to_string()))
            }
        },
        convert::Kind::Unsupported => (None, Some("định dạng chưa được hỗ trợ".to_string())),
        _ => (None, None),
    };
    FileProbe { path, name, kind, size, pages, error, needs_password }
}

#[tauri::command]
pub async fn probe_files(paths: Vec<PathBuf>, password: Option<String>) -> Result<Vec<FileProbe>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.into_iter().map(|p| probe(p, password.as_deref())).collect())
        .await
        .map_err(|e| e.to_string())
}

/// Đường dẫn LibreOffice nếu máy có; giao diện dùng để báo trước file nào cần nó.
#[tauri::command]
pub fn office_status() -> Option<PathBuf> {
    convert::find_office()
}

/// Cờ huỷ riêng cho việc tải LibreOffice (tách khỏi cờ của Gộp file).
#[derive(Default)]
pub struct OfficeCancel(Arc<CancelFlag>);

#[tauri::command]
pub fn office_install_supported() -> bool {
    crate::office_install::supported()
}

/// Tải và cài LibreOffice; tiến trình gửi qua sự kiện `office-install-progress`. Trả đường dẫn soffice.
#[tauri::command]
pub async fn office_install(app: AppHandle, cancel: State<'_, OfficeCancel>) -> Result<PathBuf, String> {
    let cancel = Arc::clone(&cancel.0);
    cancel.reset();
    tauri::async_runtime::spawn_blocking(move || {
        crate::office_install::install(
            &mut |p| {
                let _ = app.emit("office-install-progress", p);
            },
            &cancel,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn office_install_cancel(cancel: State<'_, OfficeCancel>) {
    cancel.0.cancel();
}

/// Dung lượng file (byte), để ước lượng khi tách theo dung lượng.
#[tauri::command]
pub fn file_size(path: PathBuf) -> Result<u64, String> {
    std::fs::metadata(&path).map(|m| m.len()).map_err(|e| format!("không đọc được {}: {e}", path.display()))
}

/// Thư mục tạm chứa bản PDF được tạo khi chèn ảnh/file Office vào Page Organizer.
fn inserts_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("folioscope-inserts");
    std::fs::create_dir_all(&dir).map_err(|e| format!("không tạo được thư mục tạm: {e}"))?;
    Ok(dir)
}

/// Đưa một file về dạng PDF để chèn vào tài liệu: PDF giữ nguyên, ảnh và Word/Excel/PowerPoint được chuyển.
/// Trả `OFFICE_MISSING` khi cần LibreOffice mà máy chưa có; giao diện nhận ra chuỗi này để mời cài.
#[tauri::command]
pub async fn prepare_pdf(path: PathBuf) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let kind = convert::classify(&path);
        let office = convert::find_office();
        if kind == convert::Kind::Office && office.is_none() {
            return Err("OFFICE_MISSING".to_string());
        }
        let dir = inserts_dir()?;
        convert::to_pdf(&path, &dir, office.as_deref(), &CancelFlag::default()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ảnh dán từ clipboard (PNG, base64) thành một file PDF một trang.
#[tauri::command]
pub async fn save_clipboard_image(png_base64: String) -> Result<PathBuf, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = STANDARD.decode(png_base64.trim()).map_err(|e| format!("ảnh trong clipboard không hợp lệ: {e}"))?;
        let dir = inserts_dir()?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let png = dir.join(format!("clipboard-{stamp}.png"));
        std::fs::write(&png, bytes).map_err(|e| e.to_string())?;
        convert::to_pdf(&png, &dir, None, &CancelFlag::default()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn combine_files(
    app: AppHandle,
    cancel: State<'_, Arc<CancelFlag>>,
    request: CombineRequest,
) -> Result<CombineResult, CombineError> {
    let cancel = Arc::clone(&cancel);
    cancel.reset();
    tauri::async_runtime::spawn_blocking(move || {
        let office = convert::find_office();
        combine::combine(&request, office.as_deref(), &cancel, &mut |p| {
            let _ = app.emit("combine-progress", p);
        })
    })
    .await
    .map_err(|e| CombineError::Write(e.to_string()))?
}

#[tauri::command]
pub fn cancel_combine(cancel: State<'_, Arc<CancelFlag>>) {
    cancel.cancel();
}
