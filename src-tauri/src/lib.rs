mod pdf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![pdf::open_document, pdf::render_page])
        .run(tauri::generate_context!())
        .expect("không khởi động được Folioscope");
}
