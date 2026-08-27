use std::{fs, path::PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::config::AppConfig;

pub mod clipboard;
pub mod easyask;
pub mod emoji;
pub mod quota;
pub mod search;
pub mod timetracker;

#[derive(Serialize, Deserialize, Clone)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub enabled: bool,
    /// 模块一句话说明（manifest.json 可省略，默认空）
    #[serde(default)]
    pub description: String,
    pub default_config: serde_json::Value,
}

pub fn modules_dir(app: &AppHandle) -> PathBuf {
    if let Ok(p) = app
        .path()
        .resolve("modules", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("modules")
}

pub fn load_manifests(app: &AppHandle) -> Vec<Manifest> {
    let dir = modules_dir(app);
    let mut out = vec![];
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            if e.path().is_dir() {
                let mpath = e.path().join("manifest.json");
                if let Ok(text) = fs::read_to_string(mpath) {
                    if let Ok(m) = serde_json::from_str::<Manifest>(&text) {
                        out.push(m);
                    }
                }
            }
        }
    }
    out
}

/// 用 manifest 补齐 config.modules 缺失的模块（默认启用 + 默认配置）。
pub fn merge_manifests(cfg: &mut AppConfig, manifests: &[Manifest]) {
    for m in manifests {
        if !cfg.modules.contains_key(&m.id) {
            let mut value = m.default_config.clone();
            value["enabled"] = serde_json::json!(m.enabled);
            cfg.modules.insert(m.id.clone(), value);
        }
        if !cfg.module_order.contains(&m.id) {
            cfg.module_order.push(m.id.clone());
        }
    }
    // quota 多账户：旧配置无 accounts 字段时补默认账户（兼容旧 keyring 槽位）
    if let Some(q) = cfg.modules.get_mut("quota") {
        if q.get("accounts").and_then(|v| v.as_array()).is_none() {
            q["accounts"] = serde_json::json!([
                {
                    "id": "deepseek",
                    "kind": "deepseek",
                    "name": "DeepSeek",
                    "key_ref": "deepseek"
                },
                {
                    "id": "opencode-go",
                    "kind": "go",
                    "name": "OpenCode Go",
                    "key_ref": "opencode-go"
                }
            ]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_adds_missing_modules() {
        let mut cfg = AppConfig::default();
        cfg.modules.clear();
        let manifest = Manifest {
            id: "clipboard".into(),
            name: "剪贴板".into(),
            icon: "clipboard".into(),
            enabled: true,
            description: "记录剪贴板历史".into(),
            default_config: serde_json::json!({ "max_items": 500 }),
        };
        merge_manifests(&mut cfg, &[manifest]);
        assert!(cfg.modules.contains_key("clipboard"));
        assert_eq!(cfg.modules["clipboard"]["enabled"], serde_json::json!(true));
        assert_eq!(cfg.modules["clipboard"]["max_items"], serde_json::json!(500));
        assert_eq!(cfg.module_order, vec!["clipboard".to_string()]);
        // 幂等：再次 merge 不重复追加
        merge_manifests(&mut cfg, &[Manifest { id: "clipboard".into(), name: "剪贴板".into(), icon: "clipboard".into(), enabled: true, description: String::new(), default_config: serde_json::json!({}) }]);
        assert_eq!(cfg.module_order, vec!["clipboard".to_string()]);
    }
}