# Dựng phần menu chuột phải cho Windows 11 và gom vào src-tauri/winshell/ để Tauri đóng chung vào bộ cài:
#   folioscope_shell.dll     thành phần COM IExplorerCommand (src-tauri/shellext)
#   folioscope-shell.msix    gói "thưa" mang danh tính + khai báo menu, ký bằng chứng chỉ tự ký
#   folioscope-shell.cer     chứng chỉ công khai; app cài vào "Trusted People" khi người dùng bật menu (hỏi UAC một lần)
# Chạy trên Windows: pwsh scripts/build-shellext.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root "src-tauri/winshell"
New-Item -ItemType Directory -Force $out | Out-Null

cargo build -p folioscope-shell --release --manifest-path (Join-Path $root "src-tauri/Cargo.toml")
if ($LASTEXITCODE -ne 0) { throw "cargo build thất bại" }
Copy-Item (Join-Path $root "src-tauri/target/release/folioscope_shell.dll") $out -Force

# Thư mục tạm cho gói: manifest + hình
$pkg = Join-Path $env:RUNNER_TEMP "folioscope-pkg"
if (-not $env:RUNNER_TEMP) { $pkg = Join-Path ([IO.Path]::GetTempPath()) "folioscope-pkg" }
Remove-Item $pkg -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $pkg "Assets") | Out-Null
Copy-Item (Join-Path $root "src-tauri/shellext/package/AppxManifest.xml") $pkg
foreach ($n in "StoreLogo", "Square150x150Logo", "Square44x44Logo") {
  Copy-Item (Join-Path $root "src-tauri/icons/$n.png") (Join-Path $pkg "Assets/$n.png")
}

# Công cụ của Windows SDK (có sẵn trên runner windows-latest)
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\makeappx.exe" | Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName
$signtool = Join-Path (Split-Path $makeappx) "signtool.exe"

$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=Folioscope" -KeyUsage DigitalSignature -FriendlyName "Folioscope" `
  -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(10) `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
Export-Certificate -Cert $cert -FilePath (Join-Path $out "folioscope-shell.cer") | Out-Null

$msix = Join-Path $out "folioscope-shell.msix"
Remove-Item $msix -Force -ErrorAction SilentlyContinue
& $makeappx pack /d $pkg /p $msix /nv
if ($LASTEXITCODE -ne 0) { throw "makeappx thất bại" }
& $signtool sign /fd SHA256 /sha1 $cert.Thumbprint $msix
if ($LASTEXITCODE -ne 0) { throw "signtool thất bại" }

# Khoá riêng chỉ để ký gói này; xoá khỏi kho chứng chỉ của runner, không đưa vào bộ cài.
Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force
Write-Host "Đã dựng xong: $out"
