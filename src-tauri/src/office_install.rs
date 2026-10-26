//! Tải và cài bộ chuyển đổi LibreOffice khi người dùng cần lần đầu (không đóng kèm trong app).
//!
//! Trên Windows: tải bản MSI mới nhất từ download.documentfoundation.org, kiểm tra SHA-256,
//! rồi giải nén bằng `msiexec /a` (cài kiểu "admin image") vào thư mục dữ liệu của app, nên không cần quyền quản trị.
//! Hệ điều hành khác: người dùng tự cài LibreOffice, app vẫn tự tìm thấy.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;

use crate::combine::CancelFlag;

const BASE: &str = "https://download.documentfoundation.org/libreoffice/stable/";

/// Thư mục app dùng để chứa bản LibreOffice tự tải về.
static HOME: OnceLock<PathBuf> = OnceLock::new();

pub fn set_home(dir: PathBuf) {
    let _ = HOME.set(dir);
}

/// Tự cài được hay không (chỉ Windows).
pub fn supported() -> bool {
    cfg!(windows)
}

/// `soffice` nằm trong thư mục tự tải về, nếu đã cài.
pub fn find_managed() -> Option<PathBuf> {
    let home = HOME.get()?;
    find_soffice(&home.join("app"), 6)
}

fn find_soffice(dir: &Path, depth: u32) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "soffice.exe" } else { "soffice" };
    let direct = dir.join("program").join(exe);
    if direct.is_file() {
        return Some(direct);
    }
    if depth == 0 {
        return None;
    }
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .find_map(|e| find_soffice(&e.path(), depth - 1))
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    /// "find" | "download" | "verify" | "extract" | "done"
    pub stage: &'static str,
    /// 0..=100; `None` khi không đo được (đang giải nén).
    pub percent: Option<f32>,
    pub downloaded: u64,
    pub total: u64,
}

/// Phiên bản lớn nhất trong trang liệt kê thư mục ("25.8.3/"), so theo từng số.
pub fn latest_version(listing: &str) -> Option<String> {
    let mut best: Option<((u32, u32, u32), String)> = None;
    for part in listing.split("href=\"").skip(1) {
        let name = part.split('"').next().unwrap_or("").trim_end_matches('/');
        let nums: Vec<u32> = name.split('.').filter_map(|n| n.parse().ok()).collect();
        if nums.len() != 3 || name.split('.').count() != 3 {
            continue;
        }
        let key = (nums[0], nums[1], nums[2]);
        if best.as_ref().is_none_or(|(k, _)| key > *k) {
            best = Some((key, name.to_string()));
        }
    }
    best.map(|(_, v)| v)
}

pub fn msi_name(version: &str) -> String {
    format!("LibreOffice_{version}_Win_x86-64.msi")
}

/// Mã SHA-256 (64 ký tự hex) ở đầu file `.sha256`.
pub fn parse_sha256(text: &str) -> Option<String> {
    let first = text.split_whitespace().next()?.to_ascii_lowercase();
    (first.len() == 64 && first.chars().all(|c| c.is_ascii_hexdigit())).then_some(first)
}

/// Chỉ chạy được trên Windows (`supported()`), nhưng vẫn được biên dịch ở mọi hệ điều hành để CI bắt lỗi sớm.
pub fn install(on_progress: &mut dyn FnMut(InstallProgress), cancel: &CancelFlag) -> Result<PathBuf, String> {
    if !supported() {
        return Err("Tự cài chỉ hỗ trợ Windows. Hãy cài LibreOffice từ libreoffice.org rồi mở lại hộp thoại.".into());
    }
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    use std::time::Duration;

    use sha2::{Digest, Sha256};

    let home = HOME.get().ok_or("chưa có thư mục dữ liệu của app")?.clone();
    std::fs::create_dir_all(&home).map_err(|e| format!("không tạo được thư mục {}: {e}", home.display()))?;
    let net = |e: ureq::Error| format!("lỗi mạng: {e}. Hãy kiểm tra kết nối Internet rồi thử lại.");
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(3 * 3600)))
        .build()
        .into();
    let progress = |on: &mut dyn FnMut(InstallProgress), stage, percent, downloaded, total| {
        on(InstallProgress { stage, percent, downloaded, total });
    };
    let cancelled = || cancel.check().map_err(|_| "đã huỷ".to_string());

    progress(on_progress, "find", None, 0, 0);
    let listing = agent.get(BASE).call().map_err(net)?.body_mut().read_to_string().map_err(net)?;
    let version = latest_version(&listing).ok_or("không tìm thấy phiên bản LibreOffice mới nhất")?;
    let name = msi_name(&version);
    let url = format!("{BASE}{version}/win/x86_64/{name}");
    let sum = agent
        .get(&format!("{url}.sha256"))
        .call()
        .map_err(net)?
        .body_mut()
        .read_to_string()
        .map_err(net)?;
    let expected = parse_sha256(&sum).ok_or("không đọc được mã kiểm tra của file tải về")?;

    let part = home.join(format!("{name}.part"));
    let msi = home.join(&name);
    let result = (|| -> Result<PathBuf, String> {
        let mut resp = agent.get(&url).call().map_err(net)?;
        let total = resp
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let mut reader = resp.body_mut().as_reader();
        let mut out = std::io::BufWriter::new(std::fs::File::create(&part).map_err(|e| e.to_string())?);
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 256 * 1024];
        let (mut done, mut last_pct) = (0u64, -1.0f32);
        loop {
            cancelled()?;
            let n = reader.read(&mut buf).map_err(|e| format!("tải bị gián đoạn: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            out.write_all(&buf[..n]).map_err(|e| format!("không ghi được file tải về: {e}"))?;
            done += n as u64;
            let pct = if total > 0 { (done as f32 / total as f32 * 100.0).min(100.0) } else { 0.0 };
            if pct - last_pct >= 0.5 {
                last_pct = pct;
                progress(on_progress, "download", Some(pct), done, total);
            }
        }
        out.flush().map_err(|e| e.to_string())?;
        drop(out);

        progress(on_progress, "verify", None, done, total);
        let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if actual != expected {
            return Err("file tải về bị lỗi (mã kiểm tra không khớp). Hãy thử lại.".into());
        }
        std::fs::rename(&part, &msi).map_err(|e| e.to_string())?;

        progress(on_progress, "extract", None, done, total);
        let target = home.join("app");
        let _ = std::fs::remove_dir_all(&target);
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        let mut cmd = Command::new("msiexec");
        cmd.arg("/a").arg(&msi).arg("/qn").arg(format!("TARGETDIR={}", target.display()));
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("không chạy được msiexec: {e}"))?;
        loop {
            match child.try_wait() {
                Ok(Some(st)) if st.success() => break,
                Ok(Some(st)) => return Err(format!("giải nén LibreOffice thất bại ({st})")),
                Ok(None) => {}
                Err(e) => return Err(e.to_string()),
            }
            if cancel.check().is_err() {
                let _ = child.kill();
                let _ = child.wait();
                return Err("đã huỷ".into());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        let soffice = find_soffice(&target, 6).ok_or("giải nén xong nhưng không thấy soffice.exe")?;
        progress(on_progress, "done", Some(100.0), done, total);
        Ok(soffice)
    })();

    let _ = std::fs::remove_file(&part);
    let _ = std::fs::remove_file(&msi);
    if result.is_err() {
        // bỏ bản cài dở để lần sau cài lại từ đầu
        let _ = std::fs::remove_dir_all(home.join("app"));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_highest_numeric_version() {
        let html = r#"<a href="../">..</a><a href="24.8.7/">24.8.7/</a><a href="25.2.10/">x</a><a href="25.2.9/">x</a><a href="25.8/">x</a><a href="latest/">x</a>"#;
        assert_eq!(latest_version(html).as_deref(), Some("25.2.10"));
        assert_eq!(latest_version("<html></html>"), None);
    }

    #[test]
    fn reads_checksum_and_names_msi() {
        let h = "a".repeat(64);
        assert_eq!(parse_sha256(&format!("{h} *LibreOffice.msi\n")).as_deref(), Some(h.as_str()));
        assert_eq!(parse_sha256("không phải hash"), None);
        assert_eq!(msi_name("25.8.3"), "LibreOffice_25.8.3_Win_x86-64.msi");
    }

    #[test]
    fn finds_soffice_in_nested_admin_image() {
        let root = std::env::temp_dir().join(format!("folioscope-lo-test-{}", std::process::id()));
        let exe = if cfg!(windows) { "soffice.exe" } else { "soffice" };
        let prog = root.join("LibreOffice").join("program");
        std::fs::create_dir_all(&prog).unwrap();
        std::fs::write(prog.join(exe), b"").unwrap();
        assert_eq!(find_soffice(&root, 6), Some(prog.join(exe)));
        let _ = std::fs::remove_dir_all(&root);
    }
}
