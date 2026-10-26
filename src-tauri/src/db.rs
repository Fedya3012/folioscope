//! Cơ sở dữ liệu SQLite cục bộ: kho khoá–giá trị (JSON) cho cài đặt, file gần đây và các gói sau này.
//! Mỗi khoá là một dòng; giá trị là chuỗi JSON do giao diện tự đọc ghi.

use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// Các bước nâng cấp cấu trúc bảng, chạy lần lượt; số thứ tự lưu trong `PRAGMA user_version`.
const MIGRATIONS: &[&str] = &[
    "CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
];

pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        Self::init(Connection::open(path).map_err(|e| e.to_string())?)
    }

    pub fn in_memory() -> Result<Self, String> {
        Self::init(Connection::open_in_memory().map_err(|e| e.to_string())?)
    }

    fn init(conn: Connection) -> Result<Self, String> {
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let version: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(|e| e.to_string())?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            conn.execute_batch(sql).map_err(|e| e.to_string())?;
            conn.pragma_update(None, "user_version", i + 1).map_err(|e| e.to_string())?;
        }
        Ok(Db(Mutex::new(conn)))
    }

    pub fn all(&self) -> Result<HashMap<String, String>, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT key, value FROM kv").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn set(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, strftime('%s','now')) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value],
        ).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn remove(&self, key: &str) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM kv WHERE key = ?1", params![key]).map(|_| ()).map_err(|e| e.to_string())
    }
}

/// Toàn bộ dữ liệu một lần, để giao diện nạp vào bộ nhớ lúc khởi động.
#[tauri::command]
pub fn db_load_all(db: tauri::State<Db>) -> Result<HashMap<String, String>, String> { db.all() }

#[tauri::command]
pub fn db_set(db: tauri::State<Db>, key: String, value: String) -> Result<(), String> { db.set(&key, &value) }

#[tauri::command]
pub fn db_remove(db: tauri::State<Db>, key: String) -> Result<(), String> { db.remove(&key) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_overwrite_remove() {
        let db = Db::in_memory().unwrap();
        db.set("a", "1").unwrap();
        db.set("a", "2").unwrap();
        db.set("b", "x").unwrap();
        let all = db.all().unwrap();
        assert_eq!(all.get("a").map(String::as_str), Some("2"));
        assert_eq!(all.len(), 2);
        db.remove("a").unwrap();
        assert_eq!(db.all().unwrap().len(), 1);
    }

    #[test]
    fn persists_across_reopen_and_migrates_once() {
        let path = std::env::temp_dir().join(format!("folioscope-db-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        Db::open(&path).unwrap().set("k", "v").unwrap();
        let again = Db::open(&path).unwrap();
        assert_eq!(again.all().unwrap().get("k").map(String::as_str), Some("v"));
        drop(again);
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }
}
