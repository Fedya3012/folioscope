//! In file PDF bằng chương trình in của hệ điều hành (không tự dựng hộp thoại in).

use crate::pdf::PdfError;

/// Lệnh in cho từng hệ điều hành: (chương trình, đối số). Tách riêng để test.
pub fn print_command(os: &str, path: &str) -> (String, Vec<String>) {
    match os {
        // PowerShell tự chọn chương trình mặc định của .pdf và gửi lệnh "Print".
        "windows" => ("powershell".into(), vec![
            "-NoProfile".into(), "-NonInteractive".into(), "-Command".into(),
            format!("Start-Process -FilePath '{}' -Verb Print", path.replace('\'', "''")),
        ]),
        // macOS và Linux (CUPS): lp gửi thẳng tới máy in mặc định.
        _ => ("lp".into(), vec![path.into()]),
    }
}

#[tauri::command]
pub fn print_pdf(path: String) -> Result<(), PdfError> {
    if !std::path::Path::new(&path).is_file() {
        return Err(PdfError::Open(format!("không thấy file: {path}")));
    }
    let (prog, args) = print_command(std::env::consts::OS, &path);
    let status = std::process::Command::new(&prog).args(&args).status()
        .map_err(|e| PdfError::Save(format!("không chạy được lệnh in ({prog}): {e}")))?;
    if status.success() { Ok(()) } else { Err(PdfError::Save(format!("lệnh in báo lỗi ({status})"))) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_commands_per_os() {
        let (p, a) = print_command("linux", "/a/b.pdf");
        assert_eq!((p.as_str(), a), ("lp", vec!["/a/b.pdf".to_string()]));
        let (p, a) = print_command("windows", "C:\\it's.pdf");
        assert_eq!(p, "powershell");
        assert!(a.last().unwrap().contains("'C:\\it''s.pdf'") && a.last().unwrap().contains("-Verb Print"));
    }
}
