//! 文件类型图标（Windows Shell，与资源管理器一致）与图片缩略图提取

use super::monitor::base64_encode;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
};
use windows::Win32::UI::Shell::{
    SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

/// 按路径缓存图标 base64（None = 提取失败，不再重试）
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
    // 先查缓存
    {
        let map = cache
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap();
        if let Some(v) = map.get(key) {
            return v.clone();
        }
    }
    // 锁外执行耗时计算（image::open 大图解码可达秒级），
    // 避免不同文件的解码被同一把锁串行化导致缩略图渐次出图变慢
    let v = compute();
    // 二次加锁写入
    {
        let mut map = cache
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap();
        if map.len() >= CACHE_MAX {
            if let Some(old) = map.keys().next().cloned() {
                map.remove(&old);
            }
        }
        map.insert(key.to_string(), v.clone());
    }
    v
}

/// 获取文件图标（Shell API，与资源管理器一致），返回 PNG base64
/// 优先访问真实文件取「格式专属图标」（如 txt/图片/exe 各自独立图标）；
/// 文件不存在时回退按扩展名取关联图标，保证始终有图标显示
pub fn file_icon_png(path: &str) -> Option<String> {
    cache_get_or_insert(&ICON_CACHE, path, || {
        let png = unsafe { extract_icon(path, false) }
            .or_else(|| unsafe { extract_icon(path, true) })?;
        Some(base64_encode(&png))
    })
}

/// 通过 SHGetFileInfo 拿 HICON，再提取像素编码 PNG
/// use_attributes=true 时不访问文件本体（仅按扩展名关联取图标，用于文件已被移动/删除的情况）
unsafe fn extract_icon(path: &str, use_attributes: bool) -> Option<Vec<u8>> {
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut info = SHFILEINFOW::default();
    let flags = if use_attributes {
        SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES
    } else {
        SHGFI_ICON | SHGFI_LARGEICON
    };
    let ret = SHGetFileInfoW(
        PCWSTR(wide.as_ptr()),
        Default::default(),
        Some(&mut info),
        std::mem::size_of::<SHFILEINFOW>() as u32,
        flags,
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
        let hdc = GetDC(None);
        // 先 top-down，个别图标/DC 组合不支持时再试 bottom-up
        let rgba = read_icon_pixels(hdc, hbm, w, h, true)
            .or_else(|| read_icon_pixels(hdc, hbm, w, h, false));
        let _ = ReleaseDC(None, hdc);
        let _ = DeleteObject(HGDIOBJ(hbm.0));
        let _ = DeleteObject(HGDIOBJ(icon_info.hbmMask.0));
        let rgba = rgba?;
        let img = image::RgbaImage::from_raw(w as u32, h as u32, rgba)?;
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .ok()?;
        Some(buf)
    })();
    let _ = DestroyIcon(hicon);
    result
}

/// 读取位图像素并转为 RGBA；top_down 控制行序（false 时翻转 bottom-up 行序）
unsafe fn read_icon_pixels(
    hdc: HDC,
    hbm: HBITMAP,
    w: i32,
    h: i32,
    top_down: bool,
) -> Option<Vec<u8>> {
    let mut bi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: if top_down { -h } else { h },
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        bmiColors: [Default::default()],
    };
    let mut bgra = vec![0u8; (w as usize) * (h as usize) * 4];
    let lines = GetDIBits(
        hdc,
        hbm,
        0,
        h as u32,
        Some(bgra.as_mut_ptr() as *mut core::ffi::c_void),
        &mut bi,
        DIB_RGB_COLORS,
    );
    if lines == 0 {
        return None;
    }
    let mut rgba = Vec::with_capacity(bgra.len());
    for y in 0..h as usize {
        let row = if top_down { y } else { h as usize - 1 - y };
        let row_slice = &bgra[row * (w as usize) * 4..(row + 1) * (w as usize) * 4];
        for px in row_slice.chunks_exact(4) {
            let (b, g, r, a) = (px[0], px[1], px[2], px[3]);
            rgba.extend_from_slice(&[r, g, b, a]);
        }
    }
    Some(rgba)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证各常见扩展名都能取到图标（真实文件优先，回退按扩展名关联）
    #[test]
    fn probe_icons() {
        let dir = std::env::temp_dir().join(format!("easytool-icon-probe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let names = ["a.txt", "b.png", "c.exe", "d.docx", "e.zip", "noext"];
        let mut seen = std::collections::HashSet::new();
        for n in names {
            let p = dir.join(n);
            std::fs::write(&p, b"x").unwrap();
            let got = file_icon_png(p.to_str().unwrap());
            assert!(got.is_some(), "{n} 应能取到图标");
            assert!(got.as_ref().unwrap().len() > 100, "{n} 图标过小");
            seen.insert(got.unwrap());
        }
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(seen.len() > 1, "图标应按格式区分，而非全部通用");
    }
}
