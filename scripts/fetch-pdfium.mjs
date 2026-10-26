// Tải thư viện PDFium dựng sẵn (bblanchon/pdfium-binaries) vào src-tauri/pdfium. Chạy: npm run fetch-pdfium
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const platform = process.platform;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const target = {
  win32: { asset: `pdfium-win-${arch}`, file: join("bin", "pdfium.dll") },
  darwin: { asset: `pdfium-mac-${arch}`, file: join("lib", "libpdfium.dylib") },
  linux: { asset: `pdfium-linux-${arch}`, file: join("lib", "libpdfium.so") },
}[platform];
if (!target) throw new Error(`Hệ điều hành chưa hỗ trợ: ${platform}`);

const out = join("src-tauri", "pdfium");
const dest = join(out, target.file.split(/[\\/]/).pop());
if (existsSync(dest)) { console.log(`Đã có ${dest}`); process.exit(0); }

const url = `https://github.com/bblanchon/pdfium-binaries/releases/latest/download/${target.asset}.tgz`;
console.log(`Tải ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Tải thất bại: ${res.status}`);
const tmp = mkdtempSync(join(tmpdir(), "pdfium-"));
const archive = join(tmp, "pdfium.tgz");
writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
execFileSync("tar", ["xzf", archive, "-C", tmp]);
mkdirSync(out, { recursive: true });
copyFileSync(join(tmp, target.file), dest);
copyFileSync(join(tmp, "LICENSE"), join(out, "LICENSE"));
console.log(`Đã cài ${dest}`);
