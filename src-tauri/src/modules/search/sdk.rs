//! Everything64.dll 动态加载封装（Everything 官方 SDK，MIT 许可）
//!
//! Everything64.dll 是客户端 DLL，内部通过窗口消息/共享内存与正在运行的
//! Everything.exe 通信。因此 Everything 必须在后台运行，DLL 本身可随应用打包。
//!
//! SDK 使用进程级全局状态（C 静态变量），同一时刻只能有一个查询，故用全局互斥锁串行。
//! 查询是同步阻塞的（Query 等待 Everything 返回），调用方必须放到后台线程。

use std::ffi::CString;
use std::os::windows::ffi::OsStrExt;
use std::sync::{Mutex, OnceLock};
use windows::core::{PCSTR, PCWSTR};
use windows::Win32::Foundation::{FILETIME, FreeLibrary, HMODULE};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

/// 全局 SDK 实例：None = 加载失败或尚未尝试（可重试）
static SDK: OnceLock<Mutex<Option<EverythingSdk>>> = OnceLock::new();

/// 查询请求标志（Everything.h EVERYTHING_REQUEST_*）
pub const REQ_FULL_PATH: u32 = 0x00000004;
pub const REQ_SIZE: u32 = 0x00000010;
pub const REQ_DATE_MODIFIED: u32 = 0x00000040;
pub const REQ_ATTRIBUTES: u32 = 0x00000100;

/// 排序类型（Everything.h EVERYTHING_SORT_*）
pub const SORT_NAME_ASC: u32 = 1;
pub const SORT_NAME_DESC: u32 = 2;
pub const SORT_PATH_ASC: u32 = 3;
pub const SORT_PATH_DESC: u32 = 4;
pub const SORT_SIZE_ASC: u32 = 5;
pub const SORT_SIZE_DESC: u32 = 6;
pub const SORT_DATE_MODIFIED_ASC: u32 = 13;
pub const SORT_DATE_MODIFIED_DESC: u32 = 14;

/// 错误码（Everything.h EVERYTHING_ERROR_*）
pub const ERR_IPC: u32 = 2; // Everything 客户端未运行

/// 单个搜索结果
#[derive(Debug, Clone)]
pub struct SdkResult {
    pub name: String,
    pub path: String,
    pub full_path: String,
    pub size: Option<u64>,
    pub modified_ms: Option<i64>,
    pub is_folder: bool,
}

struct SdkFns {
    set_search: unsafe extern "system" fn(*const u16),
    set_match_path: unsafe extern "system" fn(i32),
    set_match_case: unsafe extern "system" fn(i32),
    set_match_whole_word: unsafe extern "system" fn(i32),
    set_regex: unsafe extern "system" fn(i32),
    set_max: unsafe extern "system" fn(u32),
    set_offset: unsafe extern "system" fn(u32),
    set_sort: unsafe extern "system" fn(u32),
    set_request_flags: unsafe extern "system" fn(u32),
    query: unsafe extern "system" fn(i32) -> i32,
    get_num_results: unsafe extern "system" fn() -> u32,
    get_tot_results: unsafe extern "system" fn() -> u32,
    get_result_full_path_name: unsafe extern "system" fn(u32, *mut u16, u32) -> u32,
    get_result_size: unsafe extern "system" fn(u32, *mut i64) -> i32,
    get_result_date_modified: unsafe extern "system" fn(u32, *mut FILETIME) -> i32,
    is_folder_result: unsafe extern "system" fn(u32) -> i32,
    is_db_loaded: unsafe extern "system" fn() -> i32,
    get_last_error: unsafe extern "system" fn() -> u32,
    reset: unsafe extern "system" fn(),
}

pub struct EverythingSdk {
    _module: HMODULE,
    fns: SdkFns,
}

unsafe impl Send for EverythingSdk {}
unsafe impl Sync for EverythingSdk {}

impl EverythingSdk {
    /// 从指定路径加载 DLL 并解析全部所需函数
    pub fn load(dll_path: &std::path::Path) -> Result<Self, String> {
        let wide: Vec<u16> = dll_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let module = match unsafe { LoadLibraryW(PCWSTR(wide.as_ptr())) } {
            Ok(m) => m,
            Err(e) => {
                return Err(format!("加载 Everything64.dll 失败: {e}"));
            }
        };
        // 解析失败则卸载
        let r: Result<SdkFns, String> = (|| {
            macro_rules! sym {
                ($name:ident) => {
                    get_fn(module, stringify!($name))
                        .ok_or_else(|| format!("missing symbol: {}", stringify!($name)))?
                };
            }
            let set_search = sym!(Everything_SetSearchW);
            let set_match_path = sym!(Everything_SetMatchPath);
            let set_match_case = sym!(Everything_SetMatchCase);
            let set_match_whole_word = sym!(Everything_SetMatchWholeWord);
            let set_regex = sym!(Everything_SetRegex);
            let set_max = sym!(Everything_SetMax);
            let set_offset = sym!(Everything_SetOffset);
            let set_sort = sym!(Everything_SetSort);
            let set_request_flags = sym!(Everything_SetRequestFlags);
            let query = sym!(Everything_QueryW);
            let get_num_results = sym!(Everything_GetNumResults);
            let get_tot_results = sym!(Everything_GetTotResults);
            let get_result_full_path_name = sym!(Everything_GetResultFullPathNameW);
            let get_result_size = sym!(Everything_GetResultSize);
            let get_result_date_modified = sym!(Everything_GetResultDateModified);
            let is_folder_result = sym!(Everything_IsFolderResult);
            let is_db_loaded = sym!(Everything_IsDBLoaded);
            let get_last_error = sym!(Everything_GetLastError);
            let reset = sym!(Everything_Reset);
            Ok(SdkFns {
                set_search,
                set_match_path,
                set_match_case,
                set_match_whole_word,
                set_regex,
                set_max,
                set_offset,
                set_sort,
                set_request_flags,
                query,
                get_num_results,
                get_tot_results,
                get_result_full_path_name,
                get_result_size,
                get_result_date_modified,
                is_folder_result,
                is_db_loaded,
                get_last_error,
                reset,
            })
        })();
        match r {
            Ok(fns) => Ok(EverythingSdk { _module: module, fns }),
            Err(e) => {
                unsafe { let _ = FreeLibrary(module); }
                Err(e)
            }
        }
    }

    /// 数据库是否已加载（Everything 启动初期可能尚未就绪）
    pub fn is_db_loaded(&self) -> bool {
        unsafe { (self.fns.is_db_loaded)() != 0 }
    }

    /// 执行一次同步查询，返回 (结果列表, 全部命中总数)。
    /// offset = 跳过条数（分页），max_results = 每页条数。
    /// total 在 reset 前读取，不受 max/offset 限制。
    pub fn search(
        &self,
        query: &str,
        offset: u32,
        max_results: u32,
        sort: u32,
        match_case: bool,
        match_path: bool,
        match_whole_word: bool,
        regex: bool,
    ) -> Result<(Vec<SdkResult>, u32), String> {
        unsafe {
            (self.fns.reset)();
            let wide: Vec<u16> = query.encode_utf16().chain(std::iter::once(0)).collect();
            (self.fns.set_search)(wide.as_ptr());
            (self.fns.set_match_path)(match_path as i32);
            (self.fns.set_match_case)(match_case as i32);
            (self.fns.set_match_whole_word)(match_whole_word as i32);
            (self.fns.set_regex)(regex as i32);
            (self.fns.set_max)(max_results);
            (self.fns.set_sort)(sort);
            (self.fns.set_request_flags)(REQ_FULL_PATH | REQ_SIZE | REQ_DATE_MODIFIED | REQ_ATTRIBUTES);
            (self.fns.set_offset)(offset);

            if (self.fns.query)(1) == 0 {
                let err = (self.fns.get_last_error)();
                return Err(match err {
                    ERR_IPC => "Everything 未运行".into(),
                    _ => format!("查询失败（错误码 {err}）"),
                });
            }

            let total = (self.fns.get_tot_results)();
            let count = (self.fns.get_num_results)();
            let mut results = Vec::with_capacity(count as usize);
            let mut buf = vec![0u16; 4096];
            for i in 0..count {
                let len = (self.fns.get_result_full_path_name)(i, buf.as_mut_ptr(), buf.len() as u32);
                let full_path = String::from_utf16_lossy(&buf[..len as usize]);

                let size = {
                    let mut v: i64 = 0;
                    if (self.fns.get_result_size)(i, &mut v) != 0 {
                        Some(v as u64)
                    } else {
                        None
                    }
                };

                let modified_ms = {
                    let mut ft = FILETIME::default();
                    if (self.fns.get_result_date_modified)(i, &mut ft) != 0 {
                        Some(filetime_to_ms(ft))
                    } else {
                        None
                    }
                };

                let is_folder = (self.fns.is_folder_result)(i) != 0;

                // 从完整路径拆分 name/path
                let (name, path) = split_path(&full_path);
                results.push(SdkResult {
                    name,
                    path,
                    full_path,
                    size,
                    modified_ms,
                    is_folder,
                });
            }
            (self.fns.reset)();
            Ok((results, total))
        }
    }
}

/// 获取全局 SDK 实例的互斥锁（每次查询短暂持有；失败为 None 可重试）
pub fn sdk_lock() -> MutexGuard<'static, Option<EverythingSdk>> {
    SDK.get_or_init(|| Mutex::new(None)).lock().unwrap()
}

use std::sync::MutexGuard;

/// 动态加载 DLL 后按名字解析函数指针
fn get_fn<T: Copy>(module: HMODULE, name: &str) -> Option<T> {
    let cname = CString::new(name).ok()?;
    let proc = unsafe { GetProcAddress(module, PCSTR(cname.as_ptr().cast())) };
    proc.map(|f| unsafe { std::mem::transmute_copy::<_, T>(&f) })
}

/// FILETIME（1601 年基准 100ns 单位）转 Unix 毫秒
fn filetime_to_ms(ft: FILETIME) -> i64 {
    let raw = ((ft.dwHighDateTime as i64) << 32) | ft.dwLowDateTime as i64;
    // 116444736000000000 = 1601-01-01 到 1970-01-01 的 100ns 数
    let since_epoch = raw - 11_644_473_600_000_000_0i64;
    since_epoch / 10_000
}

/// 从完整路径拆出文件名与所在目录（尾随 \ 视为路径，空路径容错）
fn split_path(full: &str) -> (String, String) {
    let full = full.trim_end_matches('\\');
    match full.rfind('\\') {
        Some(idx) => (full[idx + 1..].to_string(), full[..idx].to_string()),
        None => (full.to_string(), String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_path_basic() {
        assert_eq!(split_path(r"C:\a\b.txt"), ("b.txt".to_string(), r"C:\a".to_string()));
        assert_eq!(split_path(r"C:\folder"), ("folder".to_string(), "C:".to_string()));
        assert_eq!(split_path("file.txt"), ("file.txt".to_string(), String::new()));
        assert_eq!(split_path(r"C:\"), ("C:".to_string(), String::new()));
    }

    #[test]
    fn filetime_conversion() {
        // 1970-01-01 00:00:00 UTC 的 FILETIME 为 116444736000000000
        let epoch_ft = 11_644_473_600_000_000_0i64;
        let ft = FILETIME {
            dwLowDateTime: epoch_ft as u32,
            dwHighDateTime: (epoch_ft >> 32) as u32,
        };
        assert_eq!(filetime_to_ms(ft), 0);
        // 一秒后 = 1000ms
        let one_sec = epoch_ft + 10_000_000;
        let ft = FILETIME {
            dwLowDateTime: one_sec as u32,
            dwHighDateTime: (one_sec >> 32) as u32,
        };
        assert_eq!(filetime_to_ms(ft), 1000);
    }

    /// 真实环境探测（需 Everything 运行 + SDK DLL 存在，默认跳过）
    #[test]
    #[ignore = "requires running Everything"]
    fn real_sdk_probe() {
        let dll = std::path::Path::new("modules/search/Everything64.dll");
        let sdk = EverythingSdk::load(dll).expect("load sdk");
        assert!(sdk.is_db_loaded(), "Everything DB should be loaded");
        let (results, total) = sdk
            .search("*.rs", 0, 5, SORT_NAME_ASC, false, false, false, false)
            .expect("query should succeed");
        assert!(!results.is_empty(), "should find some .rs files");
        // 总结果数应不小于返回条数（分页能力）
        assert!(total >= results.len() as u32);
        eprintln!("probe found {} results (tot {total}), first: {:?}", results.len(), results[0].full_path);
    }
}