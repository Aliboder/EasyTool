//! 文件存储层：图片原图/缩略图落盘与清理

use super::models::Item;
use std::path::{Path, PathBuf};

pub struct FileStore {
    root: PathBuf,
}

impl FileStore {
    /// root 下建 images/ 与 thumbs/ 两个目录
    pub fn new(root: PathBuf) -> std::io::Result<Self> {
        let images = root.join("images");
        let thumbs = root.join("thumbs");
        std::fs::create_dir_all(&images)?;
        std::fs::create_dir_all(&thumbs)?;
        Ok(FileStore { root })
    }

    pub fn images_dir(&self) -> PathBuf {
        self.root.join("images")
    }

    pub fn thumbs_dir(&self) -> PathBuf {
        self.root.join("thumbs")
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 原图 PNG 写入 images/{id}.png
    pub fn save_image(&self, id: i64, png_bytes: &[u8]) -> std::io::Result<PathBuf> {
        let path = self.images_dir().join(format!("{id}.png"));
        std::fs::write(&path, png_bytes)?;
        Ok(path)
    }

    /// 缩略图 PNG 写入 thumbs/{id}.png
    pub fn save_thumb(&self, id: i64, png_bytes: &[u8]) -> std::io::Result<PathBuf> {
        let path = self.thumbs_dir().join(format!("{id}.png"));
        std::fs::write(&path, png_bytes)?;
        Ok(path)
    }

    /// 生成缩略图 PNG：RGBA 像素缩小到最长边 max_size 内（等比例）
    pub fn make_thumb_png(
        rgba: &[u8],
        width: u32,
        height: u32,
        max_size: u32,
    ) -> Result<Vec<u8>, String> {
        if width == 0 || height == 0 {
            return Err("empty image".into());
        }
        let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())
            .ok_or("invalid rgba buffer")?;
        let dyn_img = image::DynamicImage::ImageRgba8(img);
        let thumb = if width > max_size || height > max_size {
            let scale = max_size as f64 / (width.max(height)) as f64;
            let tw = ((width as f64) * scale).round().max(1.0) as u32;
            let th = ((height as f64) * scale).round().max(1.0) as u32;
            dyn_img.resize(tw, th, image::imageops::FilterType::Triangle)
        } else {
            dyn_img
        };
        let mut buf = Vec::new();
        thumb
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(buf)
    }

    /// 删除条目对应的磁盘文件（原图 + 缩略图）
    pub fn remove_files(&self, item: &Item) {
        if let Some(p) = &item.image_path {
            let _ = std::fs::remove_file(Path::new(p));
        }
        if let Some(p) = &item.thumb_path {
            let _ = std::fs::remove_file(Path::new(p));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumb_smaller_and_written() {
        let dir = std::env::temp_dir().join(format!("pasteboard-test-{}", std::process::id()));
        let store = FileStore::new(dir.clone()).unwrap();
        // 200x100 纯红图
        let rgba = vec![255u8, 0, 0, 255].repeat(200 * 100);
        let png = FileStore::make_thumb_png(&rgba, 200, 100, 48).unwrap();
        assert!(!png.is_empty());
        let path = store.save_thumb(1, &png).unwrap();
        assert!(path.exists());
        // 解码验证尺寸
        let decoded = image::load_from_memory(&png).unwrap();
        assert_eq!(decoded.width(), 48);
        assert_eq!(decoded.height(), 24);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn remove_files_deletes() {
        let dir = std::env::temp_dir().join(format!("pasteboard-test-rm-{}", std::process::id()));
        let store = FileStore::new(dir.clone()).unwrap();
        let ip = store.save_image(7, b"png-bytes").unwrap();
        let tp = store.save_thumb(7, b"thumb-bytes").unwrap();
        let item = Item {
            id: 7,
            kind: crate::modules::clipboard::models::ItemKind::Image,
            content: None,
            html: None,
            file_paths: None,
            image_path: Some(ip.to_string_lossy().into_owned()),
            thumb_path: Some(tp.to_string_lossy().into_owned()),
            hash: "h".into(),
            pinned: false,
            created_at: 0,
        };
        store.remove_files(&item);
        assert!(!ip.exists());
        assert!(!tp.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
