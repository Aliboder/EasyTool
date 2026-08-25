use serde::{Deserialize, Serialize};

/// 应用信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct App {
    pub id: i64,
    pub exe_path: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub category: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 前台会话事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    pub app_id: i64,
    pub start_time: String,
    pub end_time: Option<String>,
    pub duration_sec: i64,
    pub window_title: Option<String>,
    pub is_active: i32,
    /// 关联应用名（JOIN apps 带出，前端时间线展示用）
    #[serde(default)]
    pub app_name: String,
    #[serde(default)]
    pub category: String,
}

/// 每日统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStat {
    pub app_id: i64,
    pub app_name: String,
    pub category: String,
    /// 应用 exe 完整路径（前端取图标用）
    #[serde(default)]
    pub exe_path: String,
    pub date: String,
    pub total_duration_sec: i64,
    pub active_duration_sec: i64,
    pub session_count: i64,
}

/// 单日概览：当日总/活跃时长 + 前一日总时长（对比用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayOverview {
    pub date: String,
    pub total_sec: i64,
    pub active_sec: i64,
    pub prev_total_sec: i64,
    /// 该周期内有使用记录的应用数（概览条「应用」计数）
    pub app_count: i64,
}

/// 应用详情（含历史统计）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppDetail {
    pub app: App,
    pub today_duration_sec: i64,
    pub week_duration_sec: i64,
    pub month_duration_sec: i64,
    /// 近 7 天每日时长趋势
    pub daily_stats: Vec<DailyStat>,
}

/// 用户自定义分类规则：正则 pattern 命中 app 名或窗口标题 → 归入 category
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryRule {
    pub id: i64,
    pub pattern: String,
    pub category: String,
    /// 优先级（越大越先匹配；同优先级按 id 升序）
    pub priority: i64,
}

/// 单日分类占比（CategoryOverview 用）：按分类汇总当日全部时长
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryBreakdown {
    pub category: String,
    pub total_duration_sec: i64,
    pub active_duration_sec: i64,
}

/// 应用分类管理列表项（设置页用）：基础信息 + 是否手动锁定 + 累计时长
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppListItem {
    pub id: i64,
    pub app_name: String,
    pub exe_path: String,
    pub category: String,
    pub category_locked: bool,
    pub total_duration_sec: i64,
}

/// 根据应用名和路径自动分类（6 类；未命中兜底 system）
///
/// 匹配顺序决定优先级：游戏 → 视听娱乐 → 资源获取 → 学习创意 → 效率工具 → 系统兜底。
/// 顺序很关键：qqmusic/qqbrowser 若放在 qq(通讯) 之后会被误归效率工具，故视听、资源必须先于效率；
/// 编程助手 opencode/codex/cursor 含 "code"，需与 AI 对话类（豆包/秘塔/DeepSeek 等）区分——
/// 一个归效率工具、一个归学习创意。
/// 修改下方关键词/优先级时同步 +1，让启动重分类知道自己需要重跑。
pub const AUTO_CATEGORIZE_VERSION: u64 = 1;

pub fn auto_categorize(app_name: &str, exe_path: &str) -> String {
    let name_lower = app_name.to_lowercase();
    let path_lower = exe_path.to_lowercase();
    let matches = |ks: &[&str]| {
        ks.iter()
            .any(|k| name_lower.contains(k) || path_lower.contains(k))
    };

    // 游戏
    let game = ["steam", "wegame", "epic", "battle.net", "origin", "ubisoft", "原神", "王者", "英雄联盟", "minecraft", "genshin", "炉石", "永劫", "黑神话", "playstation", "xbox", "riot"];
    if matches(&game) {
        return "game".into();
    }

    // 视听娱乐
    let media = ["视频", "影视", "听书", "音乐", "直播", "播放器", "player", "vlc", "mpv", "potplayer", "bilibili", "哔哩", "爱奇艺", "iqiyi", "优酷", "youku", "腾讯视频", "芒果tv", "抖音", "douyin", "快手", "网易云", "netease", "qqmusic", "spotify", "netflix", "youtube", "喜马拉雅", "斗鱼", "虎牙", "huya", "douyu", "mediaplayer"];
    if matches(&media) {
        return "media".into();
    }

    // 资源获取
    let resource = ["浏览器", "browser", "chrome", "msedge", "edge", "firefox", "opera", "brave", "vivaldi", "safari", "iexplore", "搜狗", "qqbrowser", "qq浏览器", "猎豹", "下载", "迅雷", "thunder", "idm", "网盘", "百度网盘", "baidunetdisk", "阿里云盘", "aliyunpan", "夸克", "quark", "everything", "搜索"];
    if matches(&resource) {
        return "resource".into();
    }

    // 学习创意（网课/文献/PDF/翻译/思维导图/笔记 + AI 对话类 + 创作设计类）
    let study = ["学习", "课堂", "教程", "网课", "雨课堂", "腾讯课堂", "学习通", "智慧树", "mooc", "coursera", "edx", "文献", "论文", "课件", "cnki", "知网", "pdf", "acrobat", "foxit", "sumatra", "翻译", "有道", "词典", "dictionary", "笔记", "obsidian", "notion", "typora", "evernote", "印象笔记", "语雀", "思维导图", "xmind", "mindmap", "豆包", "doubao", "秘塔", "metaso", "chatgpt", "gpt", "deepseek", "kimi", "通义", "qwen", "glm", "智谱", "claude", "gemini", "chatbox", "sider", "monica", "photoshop", "illustrator", "premiere", "aftereffect", "剪映", "剪辑", "figma", "canva", "绘画", "设计", "sketch", "blender"];
    if matches(&study) {
        return "study".into();
    }

    // 效率工具（开发 + 办公 + 通讯）
    let efficiency = ["code", "visual studio", "intellij", "pycharm", "webstorm", "phpstorm", "goland", "clion", "sublime", "notepad", "nvim", "vim", "nano", "terminal", "git", "cargo", "node", "rust", "python", "java", "docker", "android studio", "eclipse", "postman", "insomnia", "dbeaver", "hbuilder", "tauri", "deno", "mysql", "sqlite", "sql", "ssh", "opencode", "codex", "cursor", "copilot", "unity", "unreal", "word", "excel", "powerpoint", "ppt", "wps", "outlook", "onenote", "office", "libreoffice", "onlyoffice", "docs", "文档", "通话", "wechat", "weixin", "微信", "qq", "telegram", "discord", "whatsapp", "slack", "teams", "zoom", "钉钉", "dingtalk", "飞书", "feishu", "lark", "企业微信", "微博", "weibo", "twitter", "instagram", "skype", "facebook"];
    if matches(&efficiency) {
        return "efficiency".into();
    }

    // 系统工具 / 兜底
    "system".into()
}

#[cfg(test)]
mod tests {
    use super::auto_categorize;

    fn cat(name: &str, exe: &str) -> String {
        auto_categorize(name, exe)
    }

    #[test]
    fn detects_all_six_classes() {
        assert_eq!(cat("winword", r"c:\office\winword.exe"), "efficiency");
        assert_eq!(cat("msedge", r"c:\edge\msedge.exe"), "resource");
        assert_eq!(cat("obsidian", r"d:\obsidian\obsidian.exe"), "study");
        assert_eq!(cat("bilibili", r"d:\bilibili\哔哩哔哩.exe"), "media");
        assert_eq!(cat("explorer", r"c:\windows\explorer.exe"), "system");
        assert_eq!(cat("steam++", r"d:\steam\steam++.exe"), "game");
    }

    #[test]
    fn qq_brand_disambiguation_media_resource_before_comm() {
        assert_eq!(cat("qqmusic", ""), "media");
        assert_eq!(cat("qqbrowser", ""), "resource");
        assert_eq!(cat("qq", r"d:\tencent\qq\qq.exe"), "efficiency");
    }

    #[test]
    fn coding_assistants_go_to_efficiency_not_study() {
        // AI 对话（豆包/秘塔）→ 学习创意；编程助手（opencode/codex/cursor）→ 效率工具
        assert_eq!(cat("doubao", ""), "study");
        assert_eq!(cat("opencode", ""), "efficiency");
        assert_eq!(cat("cursor", ""), "efficiency");
        assert_eq!(cat("codex", ""), "efficiency");
    }

    #[test]
    fn unknown_app_falls_back_to_system() {
        assert_eq!(cat("some-random-app", ""), "system");
        assert_eq!(cat("easytool", r"d:\easytool\easytool.exe"), "system");
    }
}
