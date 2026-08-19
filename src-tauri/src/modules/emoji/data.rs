//! 内置 Emoji 数据加载（读取资源 emoji.json）；检索由前端本地完成
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
pub struct EmojiEntry {
    pub char: String,
    pub group: String,
    pub group_zh: String,
    pub name_en: String,
    pub keywords_zh: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Catalog {
    emoji: Vec<EmojiEntry>,
}

static CATALOG: OnceLock<Vec<EmojiEntry>> = OnceLock::new();

/// 从模块资源目录加载 emoji.json；失败返回空列表（图片表情功能不受影响）
pub fn load(dir: &std::path::Path) -> &'static Vec<EmojiEntry> {
    CATALOG.get_or_init(|| {
        let path = dir.join("emoji").join("emoji.json");
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str::<Catalog>(&text)
                .map(|c| c.emoji)
                .unwrap_or_default(),
            Err(e) => {
                log::warn!("failed to load emoji.json: {e}");
                Vec::new()
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn load_from_disk() {
        // 用真实生成的资源验证可解析、字段齐全
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("modules");
        let list = load(&dir);
        assert!(!list.is_empty(), "emoji.json 应可加载");
        assert_eq!(list[0].group_zh.len() > 0, true, "应有中文分类名");
        assert!(list.iter().all(|e| !e.char.is_empty() && !e.name_en.is_empty()));
    }
}
