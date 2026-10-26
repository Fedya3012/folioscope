//! Trợ lý AI qua mạng. Chỉ có một nhà cung cấp (Anthropic). Khoá API do người dùng dán vào Cài đặt:
//! lưu trong kho khoá của hệ điều hành (Windows Credential Manager, macOS Keychain); Linux chỉ có
//! file riêng trong thư mục dữ liệu app. Khoá không bao giờ về lại giao diện, và việc gọi mạng nằm ở đây.

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
#[cfg(any(windows, target_os = "macos"))]
const SERVICE: &str = "Folioscope";
#[cfg(any(windows, target_os = "macos"))]
const ACCOUNT: &str = "anthropic-api-key";

static HOME: OnceLock<PathBuf> = OnceLock::new();

pub fn set_home(dir: PathBuf) {
    let _ = HOME.set(dir);
}

#[cfg(any(windows, target_os = "macos"))]
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[cfg(any(windows, target_os = "macos"))]
fn read_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.is_empty())
}
#[cfg(any(windows, target_os = "macos"))]
fn write_key(key: &str) -> Result<(), String> {
    entry()?.set_password(key).map_err(|e| format!("không lưu được khoá vào kho khoá hệ điều hành: {e}"))
}
#[cfg(any(windows, target_os = "macos"))]
fn delete_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn key_file() -> Result<PathBuf, String> {
    HOME.get().map(|d| d.join("api-key")).ok_or_else(|| "chưa có thư mục dữ liệu".to_string())
}
#[cfg(not(any(windows, target_os = "macos")))]
fn read_key() -> Option<String> {
    let s = std::fs::read_to_string(key_file().ok()?).ok()?;
    Some(s.trim().to_string()).filter(|k| !k.is_empty())
}
#[cfg(not(any(windows, target_os = "macos")))]
fn write_key(key: &str) -> Result<(), String> {
    let path = key_file()?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, key).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}
#[cfg(not(any(windows, target_os = "macos")))]
fn delete_key() -> Result<(), String> {
    match std::fs::remove_file(key_file()?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn ai_key_status() -> bool {
    read_key().is_some()
}

#[tauri::command]
pub fn ai_key_set(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.len() < 20 || key.contains(char::is_whitespace) {
        return Err("Khoá API trông không đúng. Hãy dán nguyên khoá, không có dấu cách.".into());
    }
    write_key(key)
}

#[tauri::command]
pub fn ai_key_clear() -> Result<(), String> {
    delete_key()
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize, Debug)]
pub struct ChatRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: u32,
}

fn body(req: &ChatRequest) -> serde_json::Value {
    serde_json::json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "system": req.system,
        "messages": req.messages,
    })
}

/// Lấy chữ trả lời từ phản hồi của Anthropic, hoặc câu lỗi dễ hiểu.
fn parse_reply(status: u16, text: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|_| format!("phản hồi lạ từ dịch vụ AI (mã {status})"))?;
    if status >= 400 {
        let msg = v["error"]["message"].as_str().unwrap_or("không rõ lỗi");
        return Err(match status {
            401 => "Khoá API bị từ chối. Hãy kiểm tra lại khoá trong Cài đặt → AI Assistant.".into(),
            403 => "Khoá API không có quyền dùng mô hình này.".into(),
            429 => "Dịch vụ AI đang giới hạn tốc độ hoặc hết hạn mức. Đợi một lúc rồi thử lại.".into(),
            _ => format!("dịch vụ AI báo lỗi {status}: {msg}"),
        });
    }
    let out: String = v["content"]
        .as_array()
        .map(|a| a.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join(""))
        .unwrap_or_default();
    if out.is_empty() { Err("AI không trả lời gì.".into()) } else { Ok(out) }
}

fn call(req: ChatRequest) -> Result<String, String> {
    let key = read_key().ok_or("Chưa có khoá API. Dán khoá trong Cài đặt → AI Assistant.")?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(180)))
        .http_status_as_error(false)
        .build()
        .into();
    let mut resp = agent
        .post(API_URL)
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .send(body(&req).to_string())
        .map_err(|e| format!("lỗi mạng: {e}. Hãy kiểm tra kết nối Internet rồi thử lại."))?;
    let status = resp.status().as_u16();
    let text = resp.body_mut().read_to_string().map_err(|e| e.to_string())?;
    parse_reply(status, &text)
}

#[tauri::command]
pub async fn ai_chat(request: ChatRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || call(request)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_text_is_joined() {
        let t = r#"{"content":[{"type":"text","text":"Xin "},{"type":"text","text":"chào"}]}"#;
        assert_eq!(parse_reply(200, t).unwrap(), "Xin chào");
    }

    #[test]
    fn errors_are_friendly() {
        let t = r#"{"error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        assert!(parse_reply(401, t).unwrap_err().contains("Khoá API bị từ chối"));
        assert!(parse_reply(500, t).unwrap_err().contains("invalid x-api-key"));
        assert!(parse_reply(200, "không phải json").is_err());
    }

    #[test]
    fn body_has_system_and_messages() {
        let req = ChatRequest { model: "m".into(), system: "s".into(), max_tokens: 5, messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }] };
        let b = body(&req);
        assert_eq!(b["system"], "s");
        assert_eq!(b["messages"][0]["content"], "hi");
    }
}
