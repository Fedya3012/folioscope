mod annotations;
mod organizer;
mod pdf;
mod viewer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pdf::open_document,
            pdf::render_page,
            pdf::save_annotations,
            viewer::get_outline,
            viewer::get_text_runs,
            viewer::search_text,
            organizer::export_pages
        ])
        .run(tauri::generate_context!())
        .expect("không khởi động được Folioscope");
}
