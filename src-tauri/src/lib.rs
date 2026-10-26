mod annotations;
mod combine;
mod commands;
mod content;
mod db;
mod fsutil;
mod launch;
mod office_install;
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
        .manage(commands::OfficeCancel::default())
        .manage(Arc::new(launch::Launch::default()))
        .setup(|app| {
            use tauri::Manager;
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            app.manage(db::Db::open(&data_dir.join("folioscope.sqlite"))?);
            office_install::set_home(data_dir.join("libreoffice"));
            let args: Vec<String> = std::env::args().collect();
            launch::handle_args(app.handle(), &args);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pdf::open_document,
            pdf::render_page,
            pdf::save_annotations,
            content::list_page_objects,
            content::render_page_edited,
            content::save_content_edits,
            viewer::get_outline,
            viewer::get_text_runs,
            viewer::search_text,
            commands::probe_files,
            commands::office_status,
            commands::office_install_supported,
            commands::office_install,
            commands::office_install_cancel,
            commands::file_size,
            commands::prepare_pdf,
            commands::save_clipboard_image,
            commands::combine_files,
            commands::cancel_combine,
            launch::take_launch_files,
            shell_menu::shell_menu_status,
            shell_menu::shell_menu_install,
            shell_menu::shell_menu_uninstall,
            organizer::export_pages,
            db::db_load_all,
            db::db_set,
            db::db_remove
        ])
        .run(tauri::generate_context!())
        .expect("không khởi động được Folioscope");
}
