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
}

fn probe(path: PathBuf) -> FileProbe {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let kind = convert::classify(&path);
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let (pages, error) = match kind {
        convert::Kind::Pdf => match combine::merge::load(&path) {
            Ok(d) => (Some(d.get_pages().len()), None),
            Err(e) => (None, Some(e)),
        },
        convert::Kind::Unsupported => (None, Some("định dạng chưa được hỗ trợ".to_string())),
        _ => (None, None),
    };
    FileProbe { path, name, kind, size, pages, error }
}

#[tauri::command]
pub async fn probe_files(paths: Vec<PathBuf>) -> Result<Vec<FileProbe>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.into_iter().map(probe).collect())
        .await
        .map_err(|e| e.to_string())
}

/// Đường dẫn LibreOffice nếu máy có; giao diện dùng để báo trước file nào cần nó.
#[tauri::command]
pub fn office_status() -> Option<PathBuf> {
    convert::find_office()
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
