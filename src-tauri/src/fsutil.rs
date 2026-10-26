use std::path::{Path, PathBuf};

/// Thay `out` bằng file tạm `tmp` đã ghi xong. Nếu `out` đã có và `keep_backup` bật, bản cũ được giữ lại thành `<tên>.bak`.
/// Lỗi giữa chừng không bao giờ để `out` ở trạng thái ghi dở.
pub fn commit_tmp(tmp: &Path, out: &Path, keep_backup: bool) -> std::io::Result<()> {
    if keep_backup && out.exists() {
        std::fs::copy(out, backup_path(out))?;
    }
    std::fs::rename(tmp, out)
}

pub fn backup_path(out: &Path) -> PathBuf {
    let mut name = out.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".bak");
    out.with_file_name(name)
}

/// Đường dẫn file tạm cạnh đích (cùng ổ đĩa để đổi tên là nguyên tử).
pub fn tmp_path(out: &Path) -> PathBuf {
    let mut name = out.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".part");
    out.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("folioscope-fsutil-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn replaces_and_keeps_one_backup() {
        let d = dir("backup");
        let out = d.join("a.pdf");
        std::fs::write(&out, "cu").unwrap();
        let tmp = tmp_path(&out);
        std::fs::write(&tmp, "moi").unwrap();
        commit_tmp(&tmp, &out, true).unwrap();
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "moi");
        assert_eq!(std::fs::read_to_string(backup_path(&out)).unwrap(), "cu");
        assert!(!tmp.exists());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn no_backup_when_target_is_new() {
        let d = dir("new");
        let out = d.join("b.pdf");
        let tmp = tmp_path(&out);
        std::fs::write(&tmp, "x").unwrap();
        commit_tmp(&tmp, &out, true).unwrap();
        assert!(!backup_path(&out).exists());
        let _ = std::fs::remove_dir_all(d);
    }
}
