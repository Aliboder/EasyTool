use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::Mutex;

pub struct ImageCache {
    cache: Mutex<LruCache<String, Vec<u8>>>,
}

impl ImageCache {
    pub fn new(capacity: usize) -> Self {
        let cap = NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(100).unwrap());
        Self {
            cache: Mutex::new(LruCache::new(cap)),
        }
    }

    pub fn get_or_load(&self, path: &str) -> Option<Vec<u8>> {
        let mut cache = self.cache.lock().unwrap();
        
        // 检查缓存
        if let Some(data) = cache.get(path) {
            return Some(data.clone());
        }
        
        // 加载文件
        let data = std::fs::read(path).ok()?;
        cache.put(path.to_string(), data.clone());
        Some(data)
    }

    pub fn clear(&self) {
        self.cache.lock().unwrap().clear();
    }
}