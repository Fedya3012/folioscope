#![cfg_attr(not(windows), allow(dead_code))]
//! Mục "Combine files in Folioscope..." trong menu chuột phải của Windows.
//!
//! Ghi vào HKCU nên không cần quyền quản trị và gỡ sạch được. Đây là động từ cổ điển của Explorer: trên Windows 10
//! hiện ngay trong menu; trên Windows 11 nằm ở "Show more options" (Shift+F10). Mục nằm ngay menu mới của
//! Windows 11 cần gói MSIX có chữ ký, sẽ làm ở bước đóng gói.

use serde::Serialize;

pub const EXTENSIONS: [&str; 22] = [
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv", "html", "htm",
    "jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff",
];
// webp: Explorer không gán SystemFileAssociations phổ biến, thêm riêng bên dưới.
const EXTRA: [&str; 1] = ["webp"];
const VERB: &str = "Folioscope.Combine";
const LABEL: &str = "Combine files in Folioscope...";

fn all_exts() -> impl Iterator<Item = &'static str> {
    EXTENSIONS.iter().chain(EXTRA.iter()).copied()
}

fn verb_key(ext: &str) -> String {
    format!(r"HKCU\Software\Classes\SystemFileAssociations\.{ext}\shell\{VERB}")
}

/// Danh sách đối số cho `reg.exe`, tách riêng để kiểm thử được trên mọi hệ điều hành.
pub fn install_commands(exe: &str) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    for ext in all_exts() {
        let key = verb_key(ext);
        let add = |name: Option<&str>, value: String| {
            let mut v = vec!["add".to_string(), key.clone()];
            match name {
                Some(n) => v.extend(["/v".into(), n.into()]),
                None => v.push("/ve".into()),
            }
            v.extend(["/t".into(), "REG_SZ".into(), "/d".into(), value, "/f".into()]);
            v
        };
        out.push(add(None, LABEL.to_string()));
        out.push(add(Some("Icon"), format!("\"{exe}\",0")));
        let mut cmd = vec!["add".to_string(), format!(r"{key}\command"), "/ve".into(), "/t".into(), "REG_SZ".into(), "/d".into()];
        cmd.push(format!("\"{exe}\" --combine \"%1\""));
        cmd.push("/f".into());
        out.push(cmd);
    }
    out
}

pub fn uninstall_commands() -> Vec<Vec<String>> {
    all_exts().map(|e| vec!["delete".to_string(), verb_key(e), "/f".into()]).collect()
}

#[derive(Serialize)]
pub struct MenuStatus {
    pub supported: bool,
    pub installed: bool,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    fn reg(args: &[String]) -> Result<bool, String> {
        let st = Command::new("reg")
            .args(args)
            .creation_flags(0x0800_0000)
            .output()
            .map_err(|e| e.to_string())?;
        Ok(st.status.success())
    }

    pub fn status() -> MenuStatus {
        let q = vec!["query".to_string(), verb_key("pdf")];
        MenuStatus { supported: true, installed: reg(&q).unwrap_or(false) }
    }
    pub fn install() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().into_owned();
        for c in install_commands(&exe) {
            if !reg(&c)? { return Err(format!("reg.exe từ chối lệnh: {}", c.join(" "))); }
        }
        Ok(())
    }
    pub fn uninstall() -> Result<(), String> {
        for c in uninstall_commands() { let _ = reg(&c)?; }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::MenuStatus;
    pub fn status() -> MenuStatus { MenuStatus { supported: false, installed: false } }
    pub fn install() -> Result<(), String> { Err("menu chuột phải hiện chỉ có cho Windows".into()) }
    pub fn uninstall() -> Result<(), String> { Ok(()) }
}

#[tauri::command]
pub fn shell_menu_status() -> MenuStatus { imp::status() }
#[tauri::command]
pub fn shell_menu_install() -> Result<(), String> { imp::install() }
#[tauri::command]
pub fn shell_menu_uninstall() -> Result<(), String> { imp::uninstall() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_three_values_per_extension() {
        let cmds = install_commands(r"C:\Apps\Folioscope.exe");
        assert_eq!(cmds.len(), all_exts().count() * 3);
        let cmd = cmds.iter().find(|c| c[1].ends_with(r".pdf\shell\Folioscope.Combine\command")).unwrap();
        assert!(cmd.contains(&r#""C:\Apps\Folioscope.exe" --combine "%1""#.to_string()));
        assert!(cmds.iter().all(|c| c[1].starts_with(r"HKCU\Software\Classes\SystemFileAssociations\.")));
    }

    #[test]
    fn uninstall_removes_every_verb() {
        assert_eq!(uninstall_commands().len(), all_exts().count());
    }
}
