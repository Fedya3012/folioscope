//! Mục "Combine files in Folioscope..." trong menu chuột phải chính của Windows 11.
//!
//! Windows 11 chỉ nạp mục menu mới từ một thành phần COM `IExplorerCommand` thuộc gói có danh tính
//! (xem `package/AppxManifest.xml`). DLL này nằm cạnh app trong `shellext\`, nhận cả danh sách file đã chọn
//! trong một lần gọi và chạy `Folioscope.exe --combine <file>...`; app lo phần còn lại (single-instance, mở hộp thoại Gộp).
#![cfg(windows)]
#![allow(non_snake_case)]

use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, Ordering};

use windows::core::{implement, w, Interface, GUID, HRESULT, PCWSTR, PWSTR};
use windows::Win32::Foundation::*;
use windows::Win32::System::Com::*;
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows::Win32::System::Threading::*;
use windows::Win32::UI::Shell::*;

/// Phải trùng CLSID trong AppxManifest.xml.
const CLSID: GUID = GUID::from_u128(0xaae4583d_903b_4fd6_ae4c_7409aa21e188);

/// Đuôi file gộp được; trùng danh sách của app (src/shell_menu.rs).
const EXTENSIONS: [&str; 23] = [
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv", "html", "htm",
    "jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp",
];

static MODULE: AtomicIsize = AtomicIsize::new(0);

#[no_mangle]
extern "system" fn DllMain(module: HMODULE, reason: u32, _: *mut c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH { MODULE.store(module.0 as isize, Ordering::Relaxed); }
    TRUE
}

/// `<thư mục cài>\Folioscope.exe`, với DLL ở `<thư mục cài>\shellext\`.
fn app_exe() -> Option<PathBuf> {
    let mut buf = [0u16; 1024];
    let n = unsafe { GetModuleFileNameW(HMODULE(MODULE.load(Ordering::Relaxed) as _), &mut buf) } as usize;
    if n == 0 || n >= buf.len() { return None; }
    let dll = PathBuf::from(String::from_utf16_lossy(&buf[..n]));
    Some(dll.parent()?.parent()?.join("Folioscope.exe"))
}

fn selected_paths(items: Option<&IShellItemArray>) -> Vec<String> {
    let Some(items) = items else { return vec![] };
    let count = unsafe { items.GetCount() }.unwrap_or(0);
    (0..count)
        .filter_map(|i| unsafe {
            let name = items.GetItemAt(i).ok()?.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let s = name.to_string().ok();
            CoTaskMemFree(Some(name.0 as *const c_void));
            s
        })
        .collect()
}

fn supported(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

#[implement(IExplorerCommand)]
struct CombineCommand;

impl IExplorerCommand_Impl for CombineCommand_Impl {
    fn GetTitle(&self, _: Option<&IShellItemArray>) -> windows::core::Result<PWSTR> {
        unsafe { SHStrDupW(w!("Combine files in Folioscope...")) }
    }

    fn GetIcon(&self, _: Option<&IShellItemArray>) -> windows::core::Result<PWSTR> {
        let exe = app_exe().ok_or(E_FAIL)?;
        let spec: Vec<u16> = format!("{},0", exe.display()).encode_utf16().chain(Some(0)).collect();
        unsafe { SHStrDupW(PCWSTR(spec.as_ptr())) }
    }

    fn GetToolTip(&self, _: Option<&IShellItemArray>) -> windows::core::Result<PWSTR> { Err(E_NOTIMPL.into()) }

    fn GetCanonicalName(&self) -> windows::core::Result<GUID> { Ok(CLSID) }

    /// Chỉ hiện khi trong vùng chọn có ít nhất một file gộp được.
    fn GetState(&self, items: Option<&IShellItemArray>, _slow: BOOL) -> windows::core::Result<u32> {
        let show = selected_paths(items).iter().any(|p| supported(p));
        Ok(if show { ECS_ENABLED.0 } else { ECS_HIDDEN.0 } as u32)
    }

    fn Invoke(&self, items: Option<&IShellItemArray>, _: Option<&IBindCtx>) -> windows::core::Result<()> {
        let files: Vec<String> = selected_paths(items).into_iter().filter(|p| supported(p)).collect();
        if files.is_empty() { return Ok(()); }
        let exe = app_exe().ok_or(E_FAIL)?;
        let mut cmd = format!("\"{}\" --combine", exe.display());
        for f in &files { cmd.push_str(&format!(" \"{f}\"")); }
        let mut wide: Vec<u16> = cmd.encode_utf16().chain(Some(0)).collect();
        let si = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, ..Default::default() };
        let mut pi = PROCESS_INFORMATION::default();
        unsafe {
            CreateProcessW(PCWSTR::null(), PWSTR(wide.as_mut_ptr()), None, None, false, PROCESS_CREATION_FLAGS(0), None, PCWSTR::null(), &si, &mut pi)?;
            let _ = CloseHandle(pi.hThread);
            let _ = CloseHandle(pi.hProcess);
        }
        Ok(())
    }

    fn GetFlags(&self) -> windows::core::Result<u32> { Ok(ECF_DEFAULT.0 as u32) }

    fn EnumSubCommands(&self) -> windows::core::Result<IEnumExplorerCommand> { Err(E_NOTIMPL.into()) }
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Option<&windows::core::IUnknown>, iid: *const GUID, object: *mut *mut c_void) -> windows::core::Result<()> {
        if outer.is_some() { return Err(CLASS_E_NOAGGREGATION.into()); }
        let cmd: IExplorerCommand = CombineCommand.into();
        unsafe { cmd.query(iid, object).ok() }
    }
    fn LockServer(&self, _: BOOL) -> windows::core::Result<()> { Ok(()) }
}

#[no_mangle]
unsafe extern "system" fn DllGetClassObject(clsid: *const GUID, iid: *const GUID, object: *mut *mut c_void) -> HRESULT {
    if *clsid != CLSID { return CLASS_E_CLASSNOTAVAILABLE; }
    let factory: IClassFactory = Factory.into();
    factory.query(iid, object)
}

#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT { S_FALSE }
