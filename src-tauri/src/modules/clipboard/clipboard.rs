//! 剪贴板读写封装（仅 Windows）：文本 / 图片 / 文件列表

use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
    IsClipboardFormatAvailable, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::Ole::{CF_DIB, CF_DIBV5, CF_HDROP, CF_UNICODETEXT};

/// 串行化本应用内所有剪贴板访问（OpenClipboard 同时只能有一个持有者）
static CLIP_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 注册的 "HTML Format" 剪贴板格式编号（每次运行需重新注册）
fn html_format() -> u32 {
    unsafe {
        windows::Win32::System::DataExchange::RegisterClipboardFormatW(windows::core::w!(
            "HTML Format"
        ))
    }
}

fn open_clipboard() -> bool {
    unsafe { OpenClipboard(None).is_ok() }
}

fn close_clipboard() {
    unsafe {
        let _ = CloseClipboard();
    }
}

/// 当前剪贴板文本（若存在 CF_UNICODETEXT）
pub fn read_text() -> Option<String> {
    let _guard = CLIP_MUTEX.lock().ok()?;
    if !open_clipboard() {
        return None;
    }
    let result = (|| {
        if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32) }.is_err() {
            return None;
        }
        unsafe {
            let h = HGLOBAL(GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?.0);
            let ptr = GlobalLock(h) as *const u16;
            if ptr.is_null() {
                return None;
            }
            let size = GlobalSize(h);
            let len = size / 2;
            let slice = std::slice::from_raw_parts(ptr, len as usize);
            let s = String::from_utf16_lossy(slice);
            let _ = GlobalUnlock(h);
            let trimmed = s.trim_end_matches('\0').to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
    })();
    close_clipboard();
    result
}

/// 当前剪贴板 HTML（若存在 "HTML Format" 注册格式），保留原始头部
pub fn read_html() -> Option<String> {
    let _guard = CLIP_MUTEX.lock().ok()?;
    if !open_clipboard() {
        return None;
    }
    let result = (|| {
        let fmt = html_format();
        if fmt == 0 || unsafe { IsClipboardFormatAvailable(fmt) }.is_err() {
            return None;
        }
        unsafe {
            let h = HGLOBAL(GetClipboardData(fmt).ok()?.0);
            let ptr = GlobalLock(h) as *const u8;
            if ptr.is_null() {
                return None;
            }
            let size = GlobalSize(h);
            let slice = std::slice::from_raw_parts(ptr, size as usize);
            let s = String::from_utf8_lossy(slice);
            let _ = GlobalUnlock(h);
            let s = s.trim_end_matches('\0').to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
    })();
    close_clipboard();
    result
}

/// 当前剪贴板文件列表（若存在 CF_HDROP）
pub fn read_files() -> Option<Vec<String>> {
    let _guard = CLIP_MUTEX.lock().ok()?;
    if !open_clipboard() {
        return None;
    }
    let result = (|| {
        if unsafe { IsClipboardFormatAvailable(CF_HDROP.0 as u32) }.is_err() {
            return None;
        }
        unsafe {
            let h = HGLOBAL(GetClipboardData(CF_HDROP.0 as u32).ok()?.0);
            let base = GlobalLock(h) as *const u8;
            if base.is_null() {
                return None;
            }
            // DROPFILES：pFiles(u32 偏移) + pt(8) + fNC(u32) + fWide(u32)
            let pfiles = *(base as *const u32) as usize;
            let fwide = *(base.add(16) as *const u32) != 0;
            let list_ptr = base.add(pfiles);
            let mut out = Vec::new();
            let mut cur = list_ptr;
            loop {
                let start = cur;
                let mut len = 0usize;
                if fwide {
                    while *((start as *const u16).add(len)) != 0 {
                        len += 1;
                    }
                } else {
                    while *start.add(len) != 0 {
                        len += 1;
                    }
                }
                if len == 0 {
                    break;
                }
                let s = if fwide {
                    String::from_utf16_lossy(std::slice::from_raw_parts(start as *const u16, len))
                } else {
                    String::from_utf8_lossy(std::slice::from_raw_parts(start, len)).to_string()
                };
                out.push(s);
                cur = if fwide {
                    start.add((len + 1) * 2)
                } else {
                    start.add(len + 1)
                };
            }
            let _ = GlobalUnlock(h);
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
    })();
    close_clipboard();
    result
}

/// 当前剪贴板图片（若存在 CF_DIB / CF_DIBV5），返回 RGBA 像素 + 宽高
pub fn read_image_rgba() -> Option<(Vec<u8>, u32, u32)> {
    let _guard = CLIP_MUTEX.lock().ok()?;
    if !open_clipboard() {
        return None;
    }
    let result = (|| unsafe {
        let format = if IsClipboardFormatAvailable(CF_DIBV5.0 as u32).is_ok() {
            CF_DIBV5.0 as u32
        } else if IsClipboardFormatAvailable(CF_DIB.0 as u32).is_ok() {
            CF_DIB.0 as u32
        } else {
            return None;
        };
        let h = HGLOBAL(GetClipboardData(format).ok()?.0);
        let ptr = GlobalLock(h) as *const u8;
        if ptr.is_null() {
            return None;
        }
        let size = GlobalSize(h);
        let result = decode_dib(ptr, size);
        let _ = GlobalUnlock(h);
        result
    })();
    close_clipboard();
    result
}

/// 解析 DIB 内存块 → RGBA
/// 布局：BITMAPINFOHEADER(biSize 起) + 像素数据（默认自下而上）
unsafe fn decode_dib(ptr: *const u8, size: usize) -> Option<(Vec<u8>, u32, u32)> {
    let header_size = *(ptr as *const u32) as usize;
    if header_size < 40 || size <= header_size {
        return None;
    }
    let width = *(ptr.add(4) as *const i32);
    let height_raw = *(ptr.add(8) as *const i32);
    let bit_count = *(ptr.add(14) as *const u16);
    let compression = *(ptr.add(16) as *const u32);

    // 仅支持 BI_RGB(0)；BI_BITFIELDS(3) 的 32bpp 按常见 BGRA 掩码处理
    if compression != 0 && compression != 3 {
        log::debug!("unsupported DIB compression {compression}");
        return None;
    }
    if width <= 0 || height_raw == 0 {
        return None;
    }

    let top_down = height_raw < 0;
    let height = height_raw.unsigned_abs();
    let bpp = match bit_count {
        24 | 32 => bit_count,
        other => {
            log::debug!("unsupported DIB bit depth {other}");
            return None;
        }
    };

    let row_stride = (width as usize * bpp as usize).div_ceil(32) * 4;
    let pixels_off = header_size;
    if pixels_off + row_stride * height as usize > size {
        return None;
    }

    let mut rgba = Vec::with_capacity((width as usize * height as usize) * 4);
    let data = ptr.add(pixels_off);
    let bytes_per_px = (bpp / 8) as usize;

    for y in 0..height as usize {
        // 自下而上：内存第一行是图像最后一行
        let src_y = if top_down {
            y
        } else {
            (height as usize - 1) - y
        };
        let row = data.add(src_y * row_stride);
        for x in 0..width as usize {
            let px = row.add(x * bytes_per_px);
            let (r, g, b) = if bytes_per_px >= 4 {
                // BGRA → RGBA
                (*px.add(2), *px.add(1), *px.add(0))
            } else {
                // BGR → RGB
                (*px.add(2), *px.add(1), *px.add(0))
            };
            rgba.extend_from_slice(&[r, g, b, 255]);
        }
    }
    Some((rgba, width as u32, height))
}

/// 把 RGBA 编码为 PNG 字节
pub fn rgba_to_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let img =
        image::RgbaImage::from_raw(width, height, rgba.to_vec()).ok_or("invalid rgba buffer")?;
    let mut buf = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

/// 从 CF_HTML 原始内容中提取 fragment 区间（StartFragment/EndFragment 之间的片段）
fn extract_fragment(cf_html: &str) -> &str {
    let read_offsets = |name: &str| -> Option<usize> {
        let idx = cf_html.find(name)?;
        let digits: String = cf_html[idx + name.len()..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        digits.parse().ok()
    };
    match (read_offsets("StartFragment:"), read_offsets("EndFragment:")) {
        (Some(s), Some(e)) if s < e && e <= cf_html.len() => &cf_html[s..e],
        _ => cf_html,
    }
}

/// 用 fragment 重建标准 CF_HTML 载荷（UTF-8 编码，头部偏移重算）
fn build_cf_html(fragment: &str) -> Vec<u8> {
    let html = format!(
        "<html>\r\n<body>\r\n<!--StartFragment-->{fragment}<!--EndFragment-->\r\n</body>\r\n</html>"
    );
    let header_prefix = "Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n";
    let frag_start = header_prefix.len()
        + html.find("<!--StartFragment-->").unwrap_or(0)
        + "<!--StartFragment-->".len();
    let frag_end = frag_start + fragment.len();
    let end_html = header_prefix.len() + html.len();
    let header = format!(
        "Version:0.9\r\nStartHTML:{:010}\r\nEndHTML:{:010}\r\nStartFragment:{:010}\r\nEndFragment:{:010}\r\n",
        header_prefix.len(),
        end_html,
        frag_start,
        frag_end
    );
    format!("{header}{html}").into_bytes()
}

/// 写入文本（含可选富文本）到剪贴板：CF_UNICODETEXT + "HTML Format"
pub fn write_text_rich(text: &str, html: Option<&str>) -> bool {
    let _guard = match CLIP_MUTEX.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    if !open_clipboard() {
        return false;
    }
    let mut ok = false;
    unsafe {
        let _ = EmptyClipboard();
        // 1. 纯文本
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes = wide.len() * 2;
        let h = match GlobalAlloc(GMEM_MOVEABLE, bytes) {
            Ok(h) => h,
            Err(_) => {
                close_clipboard();
                return false;
            }
        };
        let ptr = GlobalLock(h);
        if ptr.is_null() {
            let _ = GlobalFree(Some(h));
            close_clipboard();
            return false;
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr as *mut u16, wide.len());
        let _ = GlobalUnlock(h);
        if SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(h.0))).is_ok() {
            ok = true;
        } else {
            let _ = GlobalFree(Some(h));
        }

        // 2. 富文本（可选）
        if let Some(raw_html) = html {
            let fragment = extract_fragment(raw_html);
            if !fragment.trim().is_empty() {
                let payload = build_cf_html(fragment);
                if let Ok(h2) = GlobalAlloc(GMEM_MOVEABLE, payload.len()) {
                    let p2 = GlobalLock(h2);
                    if !p2.is_null() {
                        std::ptr::copy_nonoverlapping(
                            payload.as_ptr(),
                            p2 as *mut u8,
                            payload.len(),
                        );
                        let _ = GlobalUnlock(h2);
                        let fmt = html_format();
                        if fmt != 0 {
                            if SetClipboardData(fmt, Some(HANDLE(h2.0))).is_ok() {
                                ok = true;
                            } else {
                                let _ = GlobalFree(Some(h2));
                            }
                        }
                    }
                }
            }
        }
    }
    close_clipboard();
    ok
}

/// 写入 RGBA 像素为 CF_DIB（32bpp BGRA，BI_RGB，自下而上）到剪贴板
pub fn write_image_rgba(rgba: &[u8], width: u32, height: u32) -> bool {
    let _guard = match CLIP_MUTEX.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    if !open_clipboard() {
        return false;
    }
    let ok = unsafe {
        let _ = EmptyClipboard();
        let header_size = 40usize;
        let row_stride = width as usize * 4;
        let data_size = row_stride * height as usize;
        let total = header_size + data_size;
        let h = match GlobalAlloc(GMEM_MOVEABLE, total) {
            Ok(h) => h,
            Err(_) => {
                close_clipboard();
                return false;
            }
        };
        let ptr = GlobalLock(h);
        if ptr.is_null() {
            let _ = GlobalFree(Some(h));
            close_clipboard();
            return false;
        }
        let p = ptr as *mut u8;
        // BITMAPINFOHEADER
        let bi_size = header_size as u32;
        let bi_width = width as i32;
        let bi_height = height as i32;
        let bi_planes: u16 = 1;
        let bi_bit_count: u16 = 32;
        let bi_compression: u32 = 0; // BI_RGB
        let bi_size_image = data_size as u32;
        std::ptr::copy_nonoverlapping(&bi_size as *const u32 as *const u8, p, 4);
        std::ptr::copy_nonoverlapping(&bi_width as *const i32 as *const u8, p.add(4), 4);
        std::ptr::copy_nonoverlapping(&bi_height as *const i32 as *const u8, p.add(8), 4);
        std::ptr::copy_nonoverlapping(&bi_planes as *const u16 as *const u8, p.add(12), 2);
        std::ptr::copy_nonoverlapping(&bi_bit_count as *const u16 as *const u8, p.add(14), 2);
        std::ptr::copy_nonoverlapping(&bi_compression as *const u32 as *const u8, p.add(16), 4);
        std::ptr::copy_nonoverlapping(&bi_size_image as *const u32 as *const u8, p.add(20), 4);
        // 像素：RGBA → BGRA，自下而上
        let pixels = p.add(header_size);
        for y in 0..height as usize {
            let src_row = &rgba[y * row_stride..(y + 1) * row_stride];
            let dst_row = pixels.add((height as usize - 1 - y) * row_stride);
            for x in 0..width as usize {
                let s = x * 4;
                let d = dst_row.add(x * 4);
                *d = src_row[s + 2]; // B
                *d.add(1) = src_row[s + 1]; // G
                *d.add(2) = src_row[s]; // R
                *d.add(3) = 255; // A
            }
        }
        let _ = GlobalUnlock(h);
        let ok = SetClipboardData(CF_DIB.0 as u32, Some(HANDLE(h.0))).is_ok();
        if !ok {
            let _ = GlobalFree(Some(h));
        }
        ok
    };
    close_clipboard();
    ok
}

/// 写入文件路径列表为 CF_HDROP 到剪贴板
pub fn write_files(paths: &[String]) -> bool {
    let _guard = match CLIP_MUTEX.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    if !open_clipboard() {
        return false;
    }
    let ok = unsafe {
        let _ = EmptyClipboard();
        // DROPFILES: pFiles(u32) + pt(2×i32) + fNC(u32) + fWide(u32) = 20 字节
        let mut wide: Vec<u16> = Vec::new();
        for p in paths {
            wide.extend(p.encode_utf16());
            wide.push(0);
        }
        wide.push(0); // 列表以双 NUL 结尾
        let payload = wide.len() * 2;
        let total = 20 + payload;
        let h = match GlobalAlloc(GMEM_MOVEABLE, total) {
            Ok(h) => h,
            Err(_) => {
                close_clipboard();
                return false;
            }
        };
        let ptr = GlobalLock(h);
        if ptr.is_null() {
            let _ = GlobalFree(Some(h));
            close_clipboard();
            return false;
        }
        let p = ptr as *mut u8;
        let pfiles: u32 = 20;
        let pt_x: i32 = 0;
        let pt_y: i32 = 0;
        let f_nc: u32 = 0;
        let f_wide: u32 = 1;
        std::ptr::copy_nonoverlapping(&pfiles as *const u32 as *const u8, p, 4);
        std::ptr::copy_nonoverlapping(&pt_x as *const i32 as *const u8, p.add(4), 4);
        std::ptr::copy_nonoverlapping(&pt_y as *const i32 as *const u8, p.add(8), 4);
        std::ptr::copy_nonoverlapping(&f_nc as *const u32 as *const u8, p.add(12), 4);
        std::ptr::copy_nonoverlapping(&f_wide as *const u32 as *const u8, p.add(16), 4);
        std::ptr::copy_nonoverlapping(wide.as_ptr(), p.add(20) as *mut u16, wide.len());
        let _ = GlobalUnlock(h);
        let ok = SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(h.0))).is_ok();
        if !ok {
            let _ = GlobalFree(Some(h));
        }
        ok
    };
    close_clipboard();
    ok
}

/// 当前剪贴板格式列表（调试用）
#[allow(dead_code)]
pub fn format_names() -> Vec<String> {
    let mut out = Vec::new();
    let _guard = CLIP_MUTEX.lock();
    if !open_clipboard() {
        return out;
    }
    unsafe {
        let mut cur: u32 = 0;
        loop {
            cur = EnumClipboardFormats(cur);
            if cur == 0 {
                break;
            }
            let mut buf = [0u16; 256];
            let n = windows::Win32::System::DataExchange::GetClipboardFormatNameW(cur, &mut buf);
            if n > 0 {
                out.push(String::from_utf16_lossy(&buf[..n as usize]));
            } else {
                out.push(format!("0x{cur:X}"));
            }
        }
    }
    close_clipboard();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造带真实字节偏移的 CF_HTML（模拟浏览器复制的内容）
    fn sample_cf_html() -> String {
        let frag = "<b>你好</b>";
        let html =
            format!("<html><body><!--StartFragment-->{frag}<!--EndFragment--></body></html>");
        let header_prefix = "Version:0.9\r\nStartHTML:0000000105\r\nEndHTML:0000000214\r\nStartFragment:0000000141\r\nEndFragment:0000000168\r\n";
        let start = header_prefix.len() + "<html><body><!--StartFragment-->".len();
        let end = start + frag.len();
        let header = format!(
            "Version:0.9\r\nStartHTML:{:010}\r\nEndHTML:{:010}\r\nStartFragment:{:010}\r\nEndFragment:{:010}\r\n",
            header_prefix.len(),
            header_prefix.len() + html.len(),
            start,
            end
        );
        format!("{header}{html}")
    }

    #[test]
    fn extract_fragment_gets_marker_range() {
        let raw = sample_cf_html();
        let f = extract_fragment(&raw);
        assert_eq!(f, "<b>你好</b>");
    }

    #[test]
    fn extract_fragment_falls_back_to_full() {
        // 无头部标记时整体作为 fragment
        let f = extract_fragment("<p>plain</p>");
        assert_eq!(f, "<p>plain</p>");
    }

    #[test]
    fn build_cf_html_offsets_are_consistent() {
        let payload = build_cf_html("<b>你好</b>");
        let s = String::from_utf8(payload).unwrap();
        assert!(s.starts_with("Version:0.9\r\nStartHTML:"));
        // StartFragment 指向的位置必须恰好是 fragment 开头（前 20 字节为标记）
        let line = s
            .split("\r\n")
            .find(|l| l.starts_with("StartFragment:"))
            .unwrap();
        let off: usize = line["StartFragment:".len()..].parse().unwrap();
        assert_eq!(&s[off - 20..off], "<!--StartFragment-->");
        assert!(s[off..].starts_with("<b>你好</b>"));
        // EndFragment 指向 fragment 结尾（之后紧跟 EndFragment 标记）
        let line = s
            .split("\r\n")
            .find(|l| l.starts_with("EndFragment:"))
            .unwrap();
        let off: usize = line["EndFragment:".len()..].parse().unwrap();
        assert_eq!(&s[off - 7..off], "好</b>");
        assert!(s[off..].starts_with("<!--EndFragment-->"));
        // StartHTML < StartFragment < EndFragment < EndHTML
        let num = |k: &str| -> usize {
            let l = s.split("\r\n").find(|l| l.starts_with(k)).unwrap();
            l[k.len()..].parse().unwrap()
        };
        assert!(num("StartHTML:") < num("StartFragment:"));
        assert!(num("StartFragment:") < num("EndFragment:"));
        assert!(num("EndFragment:") < num("EndHTML:"));
    }
}
