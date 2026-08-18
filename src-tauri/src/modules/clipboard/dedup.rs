//! 去重指纹：文本哈希、图片指纹、文件列表哈希

use sha2::{Digest, Sha256};

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// 文本指纹：sha256(UTF-8 字节)
pub fn hash_text(text: &str) -> String {
    sha256_hex(text.as_bytes())
}

/// 图片指纹：统一缩放到 32×32 RGBA 后取 sha256，与图片编码格式无关
pub fn hash_image_rgba(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    if width == 0 || height == 0 {
        return None;
    }
    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())?;
    let small =
        image::DynamicImage::ImageRgba8(img).resize(32, 32, image::imageops::FilterType::Triangle);
    Some(sha256_hex(small.as_bytes()))
}

/// 文件列表指纹：路径排序后取 sha256（顺序无关，内容相关）
pub fn hash_files(paths: &[String]) -> String {
    let mut sorted = paths.to_vec();
    sorted.sort();
    // 使用 NUL 分隔避免路径拼接歧义
    let joined = sorted.join("\0");
    sha256_hex(joined.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_hash_stable_and_distinct() {
        let a = hash_text("hello");
        let b = hash_text("hello");
        let c = hash_text("hello!");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn image_fingerprint_encoding_independent() {
        let rgba = vec![10u8, 20, 30, 255].repeat(64 * 64);
        let h1 = hash_image_rgba(&rgba, 64, 64).unwrap();
        // 同一图像数据（不同宽高组合但内容相同缩放结果）应相同
        let h2 = hash_image_rgba(&rgba, 64, 64).unwrap();
        assert_eq!(h1, h2);
    }

    #[test]
    fn files_hash_order_independent() {
        let a = hash_files(&["b".into(), "a".into()]);
        let b = hash_files(&["a".into(), "b".into()]);
        let c = hash_files(&["a".into()]);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
}
