use std::{fs, path::PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::config::AppConfig;

pub mod calendar;
pub mod clipboard;
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

/// 已随本二进制编译的模块 id（白名单）。
/// 模块清单是**运行时资源**（`modules/<id>/manifest.json`）：删掉一个模块后，
/// 编译输出／安装目录里可能仍残留旧清单副本（资源复制是「只增不删」，安装器也不保证清理），
/// 于是会幽灵出现一个「点开就报错」的模块页。这里按白名单过滤，残留清单直接忽略。
pub const KNOWN_MODULES: &[&str] = &["clipboard", "quota", "search", "timetracker", "calendar"];

/// 该清单是否属于本二进制已编译的模块（不在白名单 = 已下线模块的残留清单）
pub fn is_known_module(id: &str) -> bool {
    KNOWN_MODULES.contains(&id)
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
                        if !is_known_module(&m.id) {
                            log::warn!("忽略已下线模块的残留清单: {}", m.id);
                            continue;
                        }
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

    #[test]
    fn retired_module_manifest_is_ignored() {
        // 白名单只含现役 5 个模块；已下线的表情模块残留清单必须被拒
        assert_eq!(KNOWN_MODULES.len(), 5);
        for id in ["clipboard", "quota", "search", "timetracker", "calendar"] {
            assert!(is_known_module(id), "{id} 应在白名单内");
        }
        assert!(!is_known_module("emoji"));
        assert!(!is_known_module("easyask"));
    }
}