//! Tìm Tesseract (bộ nhận dạng chữ), tải khi cần lần đầu (Windows) và tải dữ liệu ngôn ngữ (Việt, Anh...).
//!
//! Tesseract không đóng kèm trong app. Trên Windows app tải bộ cài của UB Mannheim, kiểm tra SHA-256 rồi cài vào
//! thư mục dữ liệu của app. Hệ điều hành khác: người dùng tự cài (brew, apt), app vẫn tự tìm thấy.
//! Dữ liệu ngôn ngữ nhỏ (khoảng 1 đến 4 MB mỗi ngôn ngữ) luôn được tải riêng từ kho `tessdata_fast` khi thiếu.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;

use crate::combine::convert::hide_console;
use crate::combine::CancelFlag;

static HOME: OnceLock<PathBuf> = OnceLock::new();

pub fn set_home(dir: PathBuf) {
    let _ = HOME.set(dir);
}

pub fn supported() -> bool {
    cfg!(windows)
}

const RELEASES_API: &str = "https://api.github.com/repos/UB-Mannheim/tesseract/releases/latest";
const TESSDATA_URL: &str = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/";
const PDF_TTF_URL: &str = "https://github.com/tesseract-ocr/tesseract/raw/main/tessdata/pdf.ttf";

#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    /// "find" | "download" | "verify" | "extract" | "done"
    pub stage: &'static str,
    pub percent: Option<f32>,
    pub downloaded: u64,
    pub total: u64,
}

/// `tesseract` nằm trong thư mục tự tải về, nếu đã cài.
pub fn find_managed() -> Option<PathBuf> {
    let exe = HOME.get()?.join("app").join(exe_name());
    exe.is_file().then_some(exe)
}

fn exe_name() -> &'static str {
    if cfg!(windows) { "tesseract.exe" } else { "tesseract" }
}

/// Tìm Tesseract: biến môi trường, thư mục cài mặc định, PATH, rồi bản app tự tải.
pub fn find() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("FOLIOSCOPE_TESSERACT") {
        let p = PathBuf::from(p);
        if p.is_file() { return Some(p); }
    }
    let fixed = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        "/opt/homebrew/bin/tesseract",
        "/usr/local/bin/tesseract",
        "/usr/bin/tesseract",
    ];
    if let Some(p) = fixed.iter().map(PathBuf::from).find(|p| p.is_file()) { return Some(p); }
    let on_path = std::env::var_os("PATH")
        .and_then(|paths| std::env::split_paths(&paths).map(|d| d.join(exe_name())).find(|p| p.is_file()));
    on_path.or_else(find_managed)
}

/// Thư mục dữ liệu ngôn ngữ do app tự tải.
pub fn managed_tessdata() -> Option<PathBuf> {
    HOME.get().map(|h| h.join("tessdata"))
}

/// Kết quả của `tesseract --list-langs`: thư mục dữ liệu và các ngôn ngữ có trong đó.
pub fn parse_langs(output: &str) -> (Option<PathBuf>, Vec<String>) {
    let mut lines = output.lines();
    let dir = lines
        .next()
        .and_then(|l| l.split('"').nth(1))
        .map(PathBuf::from);
    let langs = lines.map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("List of")).map(String::from).collect();
    (dir, langs)
}

pub fn list_langs(exe: &Path, tessdata: Option<&Path>) -> (Option<PathBuf>, Vec<String>) {
    let mut cmd = Command::new(exe);
    if let Some(d) = tessdata {
        cmd.arg("--tessdata-dir").arg(d);
    }
    cmd.arg("--list-langs").stdin(Stdio::null());
    hide_console(&mut cmd);
    match cmd.output() {
        // Phiên bản cũ in danh sách ra stderr.
        Ok(o) => {
            let text = if o.stdout.is_empty() { &o.stderr } else { &o.stdout };
            parse_langs(&String::from_utf8_lossy(text))
        }
        Err(_) => (None, Vec::new()),
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(3600))).build().into()
}

fn net(e: ureq::Error) -> String {
    format!("lỗi mạng: {e}. Hãy kiểm tra kết nối Internet rồi thử lại.")
}

/// Tải một URL về file, báo tiến trình; trả mã SHA-256 của nội dung.
fn download(
    agent: &ureq::Agent,
    url: &str,
    dest: &Path,
    cancel: &CancelFlag,
    mut on_bytes: impl FnMut(u64, u64),
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut resp = agent.get(url).call().map_err(net)?;
    let total = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok()).unwrap_or(0);
    let mut reader = resp.body_mut().as_reader();
    let mut out = std::io::BufWriter::new(std::fs::File::create(dest).map_err(|e| e.to_string())?);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    loop {
        cancel.check().map_err(|_| "đã huỷ".to_string())?;
        let n = reader.read(&mut buf).map_err(|e| format!("tải bị gián đoạn: {e}"))?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| format!("không ghi được file tải về: {e}"))?;
        done += n as u64;
        on_bytes(done, total);
    }
    out.flush().map_err(|e| e.to_string())?;
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Tải các file dữ liệu ngôn ngữ còn thiếu vào thư mục của app và chép `pdf.ttf` (font để tạo PDF có lớp chữ).
/// Trả thư mục dữ liệu đã đủ mọi ngôn ngữ cần dùng.
pub fn ensure_langs(exe: &Path, langs: &[String], cancel: &CancelFlag) -> Result<Option<PathBuf>, String> {
    let (sys_dir, sys_langs) = list_langs(exe, None);
    if langs.iter().all(|l| sys_langs.contains(l)) {
        return Ok(None);
    }
    let dir = managed_tessdata().ok_or("chưa có thư mục dữ liệu của app")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("không tạo được thư mục {}: {e}", dir.display()))?;
    let agent = agent();
    for lang in langs {
        if !lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(format!("tên ngôn ngữ không hợp lệ: {lang}"));
        }
        let target = dir.join(format!("{lang}.traineddata"));
        if target.is_file() { continue; }
        // Ưu tiên chép từ bản Tesseract có sẵn trên máy, chỉ tải khi chưa có.
        if let Some(src) = sys_dir.as_ref().map(|d| d.join(format!("{lang}.traineddata"))).filter(|p| p.is_file()) {
            std::fs::copy(&src, &target).map_err(|e| e.to_string())?;
            continue;
        }
        let part = dir.join(format!("{lang}.traineddata.part"));
        let res = download(&agent, &format!("{TESSDATA_URL}{lang}.traineddata"), &part, cancel, |_, _| {});
        match res {
            // File ngôn ngữ hợp lệ luôn lớn hơn 100 KB; nhỏ hơn là trang lỗi.
            Ok(_) if std::fs::metadata(&part).map(|m| m.len() > 100_000).unwrap_or(false) => {
                std::fs::rename(&part, &target).map_err(|e| e.to_string())?;
            }
            Ok(_) => {
                let _ = std::fs::remove_file(&part);
                return Err(format!("không tải được dữ liệu ngôn ngữ \"{lang}\" (file nhận về không hợp lệ)"));
            }
            Err(e) => {
                let _ = std::fs::remove_file(&part);
                return Err(e);
            }
        }
    }
    let ttf = dir.join("pdf.ttf");
    if !ttf.is_file() {
        if let Some(src) = sys_dir.as_ref().map(|d| d.join("pdf.ttf")).filter(|p| p.is_file()) {
            std::fs::copy(&src, &ttf).map_err(|e| e.to_string())?;
        } else {
            let part = dir.join("pdf.ttf.part");
            download(&agent, PDF_TTF_URL, &part, cancel, |_, _| {}).inspect_err(|_| { let _ = std::fs::remove_file(&part); })?;
            std::fs::rename(&part, &ttf).map_err(|e| e.to_string())?;
        }
    }
    Ok(Some(dir))
}

/// Từ phản hồi API GitHub của bản phát hành mới nhất: (tên file cài, địa chỉ tải, SHA-256).
pub fn pick_windows_installer(json: &str) -> Option<(String, String, String)> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("assets")?.as_array()?.iter().find_map(|a| {
        let name = a.get("name")?.as_str()?;
        if !(name.starts_with("tesseract-ocr-w64-setup") && name.ends_with(".exe")) {
            return None;
        }
        let url = a.get("browser_download_url")?.as_str()?;
        let digest = a.get("digest")?.as_str()?.strip_prefix("sha256:")?.to_ascii_lowercase();
        (digest.len() == 64 && digest.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| (name.to_string(), url.to_string(), digest))
    })
}

/// Chạy bộ cài. Nếu Windows đòi quyền quản trị (lỗi 740) thì chạy lại qua hộp thoại UAC.
#[cfg(windows)]
fn run_installer(exe: &Path, target: &Path, cancel: &CancelFlag) -> Result<(), String> {
    let mut cmd = Command::new(exe);
    cmd.arg("/S").arg(format!("/D={}", target.display())).stdout(Stdio::null()).stderr(Stdio::null());
    hide_console(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) if e.raw_os_error() == Some(740) => {
            let script = format!(
                "Start-Process -FilePath '{}' -ArgumentList '/S','/D={}' -Wait -Verb RunAs",
                exe.display().to_string().replace('\'', "''"),
                target.display().to_string().replace('\'', "''")
            );
            let mut ps = Command::new("powershell");
            ps.args(["-NoProfile", "-Command", &script]).stdout(Stdio::null()).stderr(Stdio::null());
            hide_console(&mut ps);
            ps.spawn().map_err(|e| format!("không chạy được bộ cài Tesseract: {e}"))?
        }
        Err(e) => return Err(format!("không chạy được bộ cài Tesseract: {e}")),
    };
    loop {
        match child.try_wait() {
            Ok(Some(st)) if st.success() => return Ok(()),
            Ok(Some(st)) => return Err(format!("cài Tesseract thất bại ({st}). Nếu bạn đã từ chối hộp xác nhận quyền, hãy thử lại.")),
            Ok(None) => {}
            Err(e) => return Err(e.to_string()),
        }
        if cancel.check().is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("đã huỷ".into());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

#[cfg(not(windows))]
fn run_installer(_: &Path, _: &Path, _: &CancelFlag) -> Result<(), String> {
    Err("Tự cài chỉ hỗ trợ Windows".into())
}

/// Chỉ chạy được trên Windows (`supported()`), nhưng vẫn được biên dịch ở mọi hệ điều hành để CI bắt lỗi sớm.
pub fn install(on_progress: &mut dyn FnMut(InstallProgress), cancel: &CancelFlag) -> Result<PathBuf, String> {
    if !supported() {
        return Err("Tự cài chỉ hỗ trợ Windows. Hãy cài Tesseract (ví dụ: brew install tesseract) rồi mở lại hộp thoại.".into());
    }
    let home = HOME.get().ok_or("chưa có thư mục dữ liệu của app")?.clone();
    std::fs::create_dir_all(&home).map_err(|e| format!("không tạo được thư mục {}: {e}", home.display()))?;
    let agent = agent();
    let mut emit = |stage, percent, downloaded, total| on_progress(InstallProgress { stage, percent, downloaded, total });

    emit("find", None, 0, 0);
    let json = agent.get(RELEASES_API).header("User-Agent", "folioscope").call().map_err(net)?
        .body_mut().read_to_string().map_err(net)?;
    let (name, url, expected) = pick_windows_installer(&json)
        .ok_or("không tìm thấy bộ cài Tesseract kèm mã kiểm tra. Hãy cài Tesseract từ github.com/UB-Mannheim/tesseract rồi thử lại.")?;

    let setup = home.join(&name);
    let part = home.join(format!("{name}.part"));
    let target = home.join("app");
    let result = (|| -> Result<PathBuf, String> {
        let mut last = -1.0f32;
        let actual = download(&agent, &url, &part, cancel, |done, total| {
            let pct = if total > 0 { (done as f32 / total as f32 * 100.0).min(100.0) } else { 0.0 };
            if pct - last >= 0.5 {
                last = pct;
                emit("download", Some(pct), done, total);
            }
        })?;
        emit("verify", None, 0, 0);
        if actual != expected {
            return Err("file tải về bị lỗi (mã kiểm tra không khớp). Hãy thử lại.".into());
        }
        std::fs::rename(&part, &setup).map_err(|e| e.to_string())?;
        emit("extract", None, 0, 0);
        let _ = std::fs::remove_dir_all(&target);
        run_installer(&setup, &target, cancel)?;
        let exe = find_managed().ok_or("cài xong nhưng không thấy tesseract.exe")?;
        emit("done", Some(100.0), 0, 0);
        Ok(exe)
    })();
    let _ = std::fs::remove_file(&part);
    let _ = std::fs::remove_file(&setup);
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&target);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_language_list() {
        let out = "List of available languages in \"/usr/share/tessdata/\" (3):\neng\nosd\nvie\n";
        let (dir, langs) = parse_langs(out);
        assert_eq!(dir, Some(PathBuf::from("/usr/share/tessdata/")));
        assert_eq!(langs, ["eng", "osd", "vie"]);
        // Tesseract 4 in thêm dòng "List of available languages (n):" không có đường dẫn trong ngoặc kép.
        let (dir, langs) = parse_langs("List of available languages (1):\neng\n");
        assert_eq!(dir, None);
        assert_eq!(langs, ["eng"]);
    }

    #[test]
    fn picks_installer_only_with_checksum() {
        let h = "b".repeat(64);
        let json = format!(
            r#"{{"assets":[{{"name":"notes.txt","browser_download_url":"x","digest":"sha256:{h}"}},
            {{"name":"tesseract-ocr-w64-setup-5.5.0.20241111.exe","browser_download_url":"https://example/setup.exe","digest":"sha256:{h}"}}]}}"#
        );
        let (name, url, sum) = pick_windows_installer(&json).expect("có bộ cài");
        assert_eq!((name.as_str(), url.as_str(), sum.as_str()), ("tesseract-ocr-w64-setup-5.5.0.20241111.exe", "https://example/setup.exe", h.as_str()));
        let no_digest = r#"{"assets":[{"name":"tesseract-ocr-w64-setup-5.5.exe","browser_download_url":"u"}]}"#;
        assert!(pick_windows_installer(no_digest).is_none());
        assert!(pick_windows_installer("không phải json").is_none());
    }
}
