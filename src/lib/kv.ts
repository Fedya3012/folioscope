/** Kho khoá–giá trị chạy trong bộ nhớ, ghi nền xuống nơi lưu thật (SQLite trong app, localStorage khi chạy thử/trình duyệt). */
export interface KvBackend {
  loadAll(): Promise<Record<string, string>>;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export class Kv {
  private cache = new Map<string, string>();
  constructor(private backend: KvBackend) {}

  /** Nạp toàn bộ dữ liệu một lần lúc khởi động; `legacy` là dữ liệu bản cũ (localStorage) để chuyển sang nếu chưa có. */
  async init(legacy: Record<string, string> = {}) {
    let stored: Record<string, string> = {};
    try { stored = await this.backend.loadAll(); } catch { /* không đọc được thì chạy bằng bộ nhớ, không làm app hỏng */ }
    for (const [k, v] of Object.entries(stored)) this.cache.set(k, v);
    for (const [k, v] of Object.entries(legacy)) {
      if (!this.cache.has(k)) this.setItem(k, v);
    }
  }

  getItem(key: string): string | null { return this.cache.get(key) ?? null; }

  setItem(key: string, value: string) {
    this.cache.set(key, value);
    void Promise.resolve(this.backend.set(key, value)).catch(() => {});
  }

  removeItem(key: string) {
    this.cache.delete(key);
    void Promise.resolve(this.backend.remove(key)).catch(() => {});
  }

  getJson(key: string): unknown {
    const v = this.getItem(key);
    if (v == null) return null;
    try { return JSON.parse(v); } catch { return null; }
  }

  setJson(key: string, value: unknown) { this.setItem(key, JSON.stringify(value)); }
}
