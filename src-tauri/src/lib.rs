mod annotations;
mod combine;
mod commands;
mod launch;
mod organizer;
mod pdf;
mod shell_menu;
mod viewer;

use std::sync::Arc;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Bản chạy thứ hai (mỗi file chọn trong Explorer sinh một bản) chuyển đối số cho bản đang chạy rồi thoát.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            launch::handle_args(app, &argv);
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(combine::CancelFlag::default()))
        .manage(Arc::new(launch::Launch::default()))
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            launch::handle_args(app.handle(), &args);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pdf::open_document,
            pdf::render_page,
            pdf::save_annotations,
            viewer::get_outline,
            viewer::get_text_runs,
            viewer::search_text,
            commands::probe_files,
            commands::office_status,
            commands::combine_files,
            commands::cancel_combine,
            launch::take_launch_files,
            shell_menu::shell_menu_status,
            shell_menu::shell_menu_install,
            shell_menu::shell_menu_uninstall,
            organizer::export_pages
        ])
        .run(tauri::generate_context!())
        .expect("không khởi động được Folioscope");
}
