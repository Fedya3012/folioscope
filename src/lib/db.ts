import { invoke } from "@tauri-apps/api/core";
import { Kv, type KvBackend } from "./kv";

/** Các khoá bản cũ lưu trong localStorage; lần đầu chạy bản SQLite sẽ chuyển sang. */
const LEGACY_KEYS = ["folioscope.settings", "folioscope.recent", "folioscope.theme", "folioscope.pageTheme", "folioscope.recentLayout"];

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const sqlite: KvBackend = {
  loadAll: () => invoke<Record<string, string>>("db_load_all"),
  set: (key, value) => invoke("db_set", { key, value }),
  remove: (key) => invoke("db_remove", { key }),
};

/** Chạy ngoài app (trình duyệt, test): dùng localStorage nếu có, không thì chỉ giữ trong bộ nhớ. */
const local: KvBackend = {
  async loadAll() {
    const out: Record<string, string> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("folioscope.")) out[k] = localStorage.getItem(k) ?? "";
      }
    } catch { /* không có localStorage */ }
    return out;
  },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* bỏ qua */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* bỏ qua */ } },
};

export const db = new Kv(inTauri() ? sqlite : local);

/** Gọi một lần trước khi vẽ giao diện. */
export async function initDb() {
  const legacy: Record<string, string> = {};
  if (inTauri()) {
    try {
      for (const k of LEGACY_KEYS) { const v = localStorage.getItem(k); if (v != null) legacy[k] = v; }
    } catch { /* bỏ qua */ }
  }
  await db.init(legacy);
}
