use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ItemType {
    #[serde(rename = "app")]
    App,
    #[serde(rename = "file")]
    File,
    #[serde(rename = "folder")]
    Folder,
    #[serde(rename = "url")]
    Url,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: i64,
    pub item_type: ItemType,
    pub name: String,
    pub path: String,
    pub icon_path: Option<String>,
    pub folder_id: Option<i64>,
    pub sort_order: i64,
    pub created_at: String,
    /// 使用次数（前台窗口监测累加）
    #[serde(default)]
    pub usage_count: i64,
    /// 解析后的真实目标（判重/计数匹配键），小写存储
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

/// 前台监测计数更新（推送给前端局部刷新）
#[derive(Debug, Clone, Serialize)]
pub struct UsageUpdate {
    pub id: i64,
    pub usage_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterOptions {
    pub item_type: Option<ItemType>,
    pub search: Option<String>,
    pub sort_by: Option<String>,
    pub sort_desc: Option<bool>,
}