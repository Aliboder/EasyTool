use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use super::collector;
use super::models::{AppDetail, AppListItem, CategoryBreakdown, CategoryRule, DailyStat, DayOverview, Event};
use super::TimetrackerState;

/// 今日统计
#[tauri::command]
pub fn timetracker_get_today_stats(app: AppHandle, limit: Option<i64>) -> Result<Vec<DailyStat>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_today_stats(limit.unwrap_or(10))
}

/// 本周统计
#[tauri::command]
pub fn timetracker_get_week_stats(app: AppHandle, limit: Option<i64>) -> Result<Vec<DailyStat>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_week_stats(limit.unwrap_or(10))
}

/// 本月统计
#[tauri::command]
pub fn timetracker_get_month_stats(app: AppHandle, limit: Option<i64>) -> Result<Vec<DailyStat>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_month_stats(limit.unwrap_or(10))
}

/// 指定日期时间线
#[tauri::command]
pub fn timetracker_get_app_timeline(app: AppHandle, date: String) -> Result<Vec<Event>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_app_timeline(&date)
}

/// 指定区间时间线（周/月多日图用）
#[tauri::command]
pub fn timetracker_get_app_timeline_range(app: AppHandle, start: String, end: String) -> Result<Vec<Event>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_app_timeline_range(&start, &end)
}

/// 应用详情：基础信息 + 今日/周/月时长 + 近 7 天每日趋势
#[tauri::command]
pub fn timetracker_get_app_detail(app: AppHandle, app_id: i64) -> Result<Option<AppDetail>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    let Some(app_model) = s.db.get_app(app_id)? else {
        return Ok(None);
    };
    let (today, week, month) = s.db.get_app_durations(app_id)?;
    let daily_stats = s.db.get_app_daily_trend(app_id, 7)?;
    Ok(Some(AppDetail {
        app: app_model,
        today_duration_sec: today,
        week_duration_sec: week,
        month_duration_sec: month,
        daily_stats,
    }))
}

/// 任意一天统计（日期回看）
#[tauri::command]
pub fn timetracker_get_day_stats(app: AppHandle, date: String, limit: Option<i64>) -> Result<Vec<DailyStat>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_day_stats(&date, limit.unwrap_or(10))
}

/// 单日概览：当日总/活跃时长 + 前一日总时长
#[tauri::command]
pub fn timetracker_get_day_overview(app: AppHandle, date: String) -> Result<DayOverview, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_day_overview(&date)
}

/// 近 N 天每日总时长（卡片迷你趋势）
#[tauri::command]
pub fn timetracker_get_daily_totals(app: AppHandle, days: Option<i64>) -> Result<Vec<(String, i64)>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_daily_totals(days.unwrap_or(7))
}

/// 托盘用：今日 Top N（含应用名与时长，供菜单文本刷新）
#[tauri::command]
pub fn timetracker_today_top(app: AppHandle, limit: Option<i64>) -> Result<Vec<DailyStat>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_today_stats(limit.unwrap_or(3))
}

/// 暂停/恢复录制（同步采集器 atomic；暂停瞬间结算当前会话）
#[tauri::command]
pub fn timetracker_set_recording(_app: AppHandle, recording: bool) -> Result<(), String> {
    collector::set_recording(recording);
    Ok(())
}

/// 当前是否录制中
#[tauri::command]
pub fn timetracker_is_recording() -> bool {
    collector::is_recording()
}

/// 设置应用分类
#[tauri::command]
pub fn timetracker_set_category(app: AppHandle, app_id: i64, category: String) -> Result<(), String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.update_app_category(app_id, &category)
}

/// 删除事件
#[tauri::command]
pub fn timetracker_delete_event(app: AppHandle, event_id: i64) -> Result<(), String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.delete_event(event_id)
}

/// 单日分类占比（按分类聚合当日全部时长）
#[tauri::command]
pub fn timetracker_get_category_breakdown(app: AppHandle, date: String) -> Result<Vec<CategoryBreakdown>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_category_breakdown(&date)
}

/// 区间分类占比（本周/本月）
#[tauri::command]
pub fn timetracker_get_category_breakdown_range(app: AppHandle, start: String, end: String) -> Result<Vec<CategoryBreakdown>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_category_breakdown_range(&start, &end)
}

/// 本周概览
#[tauri::command]
pub fn timetracker_get_week_overview(app: AppHandle) -> Result<DayOverview, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_week_overview()
}

/// 本月概览
#[tauri::command]
pub fn timetracker_get_month_overview(app: AppHandle) -> Result<DayOverview, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_month_overview()
}

/// 列出所有分类规则
#[tauri::command]
pub fn timetracker_list_rules(app: AppHandle) -> Result<Vec<CategoryRule>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.get_category_rules()
}

/// 新增分类规则
#[tauri::command]
pub fn timetracker_add_rule(app: AppHandle, pattern: String, category: String) -> Result<i64, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.add_category_rule(&pattern, &category)
}

/// 更新分类规则
#[tauri::command]
pub fn timetracker_update_rule(app: AppHandle, id: i64, pattern: String, category: String) -> Result<(), String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.update_category_rule(id, &pattern, &category)
}

/// 删除分类规则
#[tauri::command]
pub fn timetracker_delete_rule(app: AppHandle, id: i64) -> Result<(), String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.delete_category_rule(id)
}

/// 用当前规则重新分类所有已有应用
#[tauri::command]
pub fn timetracker_reapply_rules(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.reapply_categories()
}

/// 列出所有应用（含分类手动标记与累计时长）
#[tauri::command]
pub fn timetracker_list_apps(app: AppHandle) -> Result<Vec<AppListItem>, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.list_apps()
}

/// 解除手动锁定并重新归类单个应用（恢复自动分类）
#[tauri::command]
pub fn timetracker_reset_app_category(app: AppHandle, app_id: i64) -> Result<(), String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.reset_app_category(app_id)
}

/// 清空全部时长统计历史（事件与应用记录；保留分类规则与手动归类）
#[tauri::command]
pub fn timetracker_clear_history(app: AppHandle) -> Result<u32, String> {
    let state = app.state::<Mutex<TimetrackerState>>();
    let s = state.lock().map_err(|e| format!("获取状态失败: {e}"))?;
    s.db.clear_history().map_err(|e| e.to_string())
}
