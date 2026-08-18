//! 文件类型图标（Windows Shell，与资源管理器一致）与图片缩略图提取

use super::monitor::base64_encode;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::UI::Shell::{
    SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

/// 按扩展名缓存图标 base64（None = 提取失败，不再重试）
static ICON_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
/// 按路径缓存缩略图/大预览 base64（避免同一文件反复解码，上限 200 防内存膨胀）
static THUMB_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
static PREVIEW_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
const CACHE_MAX: usize = 200;

/// 带容量上限的缓存读取/写入（超出删最旧，迭代顺序 = 插入顺序）
fn cache_get_or_insert(
    cache: &OnceLock<Mutex<HashMap<String, Option<String>>>>,
    key: &str,
    compute: impl FnOnce() -> Option<String>,
) -> Option<String> {
    let mut map = cache
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap();
    if let Some(v) = map.get(key) {
        return v.clone();
    }
    let v = compute();
    if map.len() >= CACHE_MAX {
        if let Some(old) = map.keys().next().cloned() {
            map.remove(&old);
        }
    }
    map.insert(key.to_string(), v.clone());
    v
}

/// 获取文件类型图标（Shell API，与资源管理器一致），返回 PNG base64
pub fn file_icon_png(path: &str) -> Option<String> {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let cache = ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(cached) = cache.lock().unwrap().get(&ext).cloned() {
        return cached;
    }
    let result = unsafe { extract_icon(path) }.map(|png| base64_encode(&png));
    cache.lock().unwrap().insert(ext, result.clone());
    result
}

/// 通过 SHGetFileInfo 拿 HICON，再提取像素编码 PNG
unsafe fn extract_icon(path: &str) -> Option<Vec<u8>> {
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut info = SHFILEINFOW::default();
    let ret = SHGetFileInfoW(
        PCWSTR(wide.as_ptr()),
        Default::default(),
        Some(&mut info),
        std::mem::size_of::<SHFILEINFOW>() as u32,
        // USEFILEATTRIBUTES：不访问文件本体，仅按扩展名关联取系统图标——
        // 剪贴板记录的是路径引用，原文件可能已被移动/删除，图标仍应正确显示
        SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES,
    );
    if ret == 0 || info.hIcon.0.is_null() {
        return None;
    }
    let hicon = info.hIcon;
    let result = (|| {
        let mut icon_info = ICONINFO::default();
        if GetIconInfo(hicon, &mut icon_info).is_err() {
            return None;
        }
        let hbm = icon_info.hbmColor;
        let mut bmp = BITMAP::default();
        let got = GetObjectW(
            HGDIOBJ(hbm.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut core::ffi::c_void),
        );
        let w = bmp.bmWidth;
        let h = bmp.bmHeight;
        if got == 0 || w <= 0 || h <= 0 {
            let _ = DeleteObject(HGDIOBJ(hbm.0));
            let _ = DeleteObject(HGDIOBJ(icon_info.hbmMask.0));
            return None;
        }
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down，避免行序翻转
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            bmiColors: [Default::default()],
        };
        let mut pixels = vec![0u8; (w * h * 4) as usize];
        let hdc = GetDC(None);
        let lines = GetDIBits(
            hdc,
            hbm,
            0,
            h as u32,
            Some(pixels.as_mut_ptr() as *mut core::ffi::c_void),
            &mut bi,
            DIB_RGB_COLORS,
        );
        let _ = ReleaseDC(None, hdc);
        let _ = DeleteObject(HGDIOBJ(hbm.0));
        let _ = DeleteObject(HGDIOBJ(icon_info.hbmMask.0));
        if lines == 0 {
            return None;
        }
        // BGRA → RGBA
        let mut rgba = Vec::with_capacity(pixels.len());
        for px in pixels.chunks_exact(4) {
            let (b, g, r, a) = (px[0], px[1], px[2], px[3]);
            rgba.extend_from_slice(&[r, g, b, a]);
        }
        let img = image::RgbaImage::from_raw(w as u32, h as u32, rgba)?;
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .ok()?;
        Some(buf)
    })();
    let _ = DestroyIcon(hicon);
    result
}

/// 图片文件缩略图（PNG base64，最长边 256，保持比例；按路径缓存）
pub fn file_thumb_png(path: &str) -> Option<String> {
    cache_get_or_insert(&THUMB_CACHE, path, || {
        let img = image::open(path).ok()?;
        let thumb = img.thumbnail(256, 256);
        let mut buf = Vec::new();
        thumb
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .ok()?;
        Some(base64_encode(&buf))
    })
}

/// 图片文件大预览（PNG base64，最长边 1024，保持比例；悬停预览用，按路径缓存）
pub fn file_preview_png(path: &str) -> Option<String> {
    cache_get_or_insert(&PREVIEW_CACHE, path, || {
        let img = image::open(path).ok()?;
        let preview = img.thumbnail(1024, 1024);
        let mut buf = Vec::new();
        preview
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .ok()?;
        Some(base64_encode(&buf))
    })
}
