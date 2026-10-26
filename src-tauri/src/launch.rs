//! Nhận danh sách file từ dòng lệnh (menu chuột phải của Windows) và gom lại thành một lần mở hộp thoại Gộp.
//!
//! Menu cổ điển của Explorer chạy chương trình một lần cho mỗi file được chọn. Bản chạy sau được plugin
//! single-instance chuyển cho bản đầu; ở đây ta chờ một lúc cho các file về đủ rồi mới báo giao diện một lần.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

const SETTLE: Duration = Duration::from_millis(700);

#[derive(Default)]
pub struct Launch {
    collecting: Mutex<Vec<String>>,
    pending: Mutex<Vec<String>>,
    generation: Mutex<u64>,
}

/// Lấy các đường dẫn đứng sau cờ `--combine`. Đối số không phải đường dẫn file thật bị bỏ.
pub fn combine_paths(args: &[String]) -> Vec<String> {
    let Some(i) = args.iter().position(|a| a == "--combine") else { return vec![] };
    args[i + 1..]
        .iter()
        .filter(|a| !a.starts_with("--"))
        .filter(|a| std::path::Path::new(a).is_file())
        .cloned()
        .collect()
}

pub fn handle_args(app: &AppHandle, args: &[String]) {
    let paths = combine_paths(args);
    if paths.is_empty() { return; }
    let state = app.state::<Arc<Launch>>();
    state.collecting.lock().unwrap().extend(paths);
    let gen = {
        let mut g = state.generation.lock().unwrap();
        *g += 1;
        *g
    };
    let (app, state) = (app.clone(), Arc::clone(&state));
    std::thread::spawn(move || {
        std::thread::sleep(SETTLE);
        if *state.generation.lock().unwrap() != gen { return; } // còn file đến sau, để lần sau báo
        let mut files = std::mem::take(&mut *state.collecting.lock().unwrap());
        files.sort();
        files.dedup();
        state.pending.lock().unwrap().extend(files);
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        let _ = app.emit("launch-combine", ());
    });
}

/// Giao diện gọi khi sẵn sàng hoặc khi nhận sự kiện; lấy đi một lần để tránh mở hộp thoại hai lần.
#[tauri::command]
pub fn take_launch_files(state: tauri::State<'_, Arc<Launch>>) -> Vec<String> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_existing_files_after_flag() {
        let f = std::env::temp_dir().join("folioscope-launch-test.txt");
        std::fs::write(&f, "x").unwrap();
        let p = f.to_string_lossy().into_owned();
        let args = vec!["folioscope".into(), "--combine".into(), p.clone(), "khong-co.pdf".into(), "--lạ".into()];
        assert_eq!(combine_paths(&args), vec![p.clone()]);
        assert!(combine_paths(&["folioscope".into(), p]).is_empty());
        let _ = std::fs::remove_file(f);
    }
}
