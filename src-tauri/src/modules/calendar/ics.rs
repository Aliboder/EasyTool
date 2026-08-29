//! ICS 导入：ical crate 解析 VEVENT（+VTODO 占位），重复规则就地"物化展开"为具体条目。
//! 物化决策：课表/日程导入后可见即所得，后续改某一节课不影响其它；规则编辑（批次 3）面向用户新建的重复事件。
//! 时区：TZID 提示一律按本机时区解读（导入文件为 Asia/Shanghai，与本机一致）；值带 Z 视为 UTC 转本地。

use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone};
use ical::parser::ical::component::IcalEvent;
use ical::parser::ical::IcalParser;
use ical::property::Property;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use super::db::{now_ms, CalendarDb, Event, Todo};
use super::expand;

/// 一条待入库的具体条目（已展开，无规则）
#[derive(Debug, Clone)]
pub struct ImportItem {
    pub title: String,
    pub location: String,
    pub notes: String,
    pub all_day: bool,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// 一个 VEVENT 解析出的原始信息
struct RawEvent {
    title: String,
    location: String,
    notes: String,
    all_day: bool,
    start: NaiveDateTime,
    duration_ms: i64,
    rrule: Option<String>,
}

/// 导入结果统计（前端 toast 展示）
#[derive(Debug, Default, serde::Serialize)]
pub struct ImportReport {
    pub events: usize,          // 解析成功的事件数（仅含规则下也按 1 计）
    pub instances: usize,       // 实际入库的具体条目数（含展开）
    pub repeated: usize,        // 含重复规则的事件数
    pub skipped: usize,         // 跳过数（缺标题/时间非法/坏条目）
    pub unsupported: usize,     // 规则不支持而降级为单次的事件数
}

/// 解析 ICS 文本（纯函数，便于单测）→ 展开后的具体条目
pub fn parse_ics(text: &str) -> ParseResult {
    let mut items: Vec<ImportItem> = Vec::new();
    let mut events = 0usize;
    let mut skipped = 0usize;
    let mut repeated = 0usize;
    let mut unsupported = 0usize;

    let mut calendar_iter = IcalParser::new(text.as_bytes());
    let calendar = match calendar_iter.next() {
        Some(Ok(cal)) => cal,
        _ => return ParseResult { items, events, skipped, repeated, unsupported },
    };
    for event in calendar.events {
        match parse_event(&event) {
            Ok(raw) => {
                events += 1;
                repeated += raw.rrule.is_some() as usize;
                // 物化：有规则 → 展开为多次；无规则 → 一次
                let instances = match &raw.rrule {
                    Some(rule) => {
                        let ex = expand::expand(raw.start, rule);
                        if ex.len() == 1 && expand::parse_rule(rule).is_none() {
                            unsupported += 1;
                        }
                        ex
                    }
                    None => vec![raw.start],
                };
                for inst in instances {
                    items.push(ImportItem {
                        title: raw.title.clone(),
                        location: raw.location.clone(),
                        notes: raw.notes.clone(),
                        all_day: raw.all_day,
                        start_ms: local_ts(inst),
                        end_ms: local_ts(inst) + raw.duration_ms,
                    });
                }
            }
            Err(_) => skipped += 1,
        }
    }
    ParseResult { items, events, skipped, repeated, unsupported }
}

pub struct ParseResult {
    pub items: Vec<ImportItem>,
    pub events: usize,
    pub skipped: usize,
    pub repeated: usize,
    pub unsupported: usize,
}

fn prop(props: &[Property], name: &str) -> Option<String> {
    props
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .and_then(|p| p.value.clone())
}

fn parse_event(ev: &IcalEvent) -> Result<RawEvent, ()> {
    let title = prop(&ev.properties, "SUMMARY")
        .map(|s| un_escape(&s))
        .unwrap_or_default();
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(());
    }
    let start_raw = prop(&ev.properties, "DTSTART").ok_or(())?;
    let tz_name = ev
        .properties
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case("DTSTART"))
        .and_then(|p| {
            p.params
                .as_ref()
                .and_then(|list| list.iter().find(|(k, _)| k.eq_ignore_ascii_case("TZID")))
                .and_then(|(_, v)| v.first().cloned())
        });
    let (start, date_only) = parse_dt(&start_raw, tz_name.as_deref()).ok_or(())?;
    let duration_ms = match prop(&ev.properties, "DTEND") {
        Some(end) => {
            let (end_ndt, _) = parse_dt(&end, tz_name.as_deref()).ok_or(())?;
            (local_ts(end_ndt) - local_ts(start)).max(0)
        }
        None => {
            if date_only {
                86_400_000 // 全天无 DTEND → 一整天
            } else {
                3_600_000
            }
        }
    };
    Ok(RawEvent {
        title,
        location: prop(&ev.properties, "LOCATION")
            .map(|s| un_escape(&s).trim().to_string())
            .unwrap_or_default(),
        notes: prop(&ev.properties, "DESCRIPTION")
            .map(|s| un_escape(&s).trim_end().to_string())
            .unwrap_or_default(),
        all_day: date_only,
        start,
        duration_ms,
        rrule: prop(&ev.properties, "RRULE").filter(|s| !s.trim().is_empty()),
    })
}

/// 解析 datetime 值：date-only(yyyymmdd) / local(yyyymmddTHHMMSS) / UTC(…Z)
fn parse_dt(v: &str, _tz: Option<&str>) -> Option<(NaiveDateTime, bool)> {
    let v = v.trim();
    let date_only = !v.contains('T');
    let (date_part, time_part) = if date_only {
        (v, None)
    } else {
        let (d, t) = v.split_once('T')?;
        let t = t.trim_end_matches('Z');
        (d, Some(t))
    };
    if date_part.len() < 8 {
        return None;
    }
    let y: i32 = date_part[0..4].parse().ok()?;
    let m: u32 = date_part[4..6].parse().ok()?;
    let d: u32 = date_part[6..8].parse().ok()?;
    let (h, mi, s) = match time_part {
        Some(t) if t.len() >= 6 => (t[0..2].parse().ok()?, t[2..4].parse().ok()?, t[4..6].parse().ok()?),
        _ => (0, 0, 0),
    };
    let ndt = NaiveDate::from_ymd_opt(y, m, d)?.and_hms_opt(h, mi, s)?;
    // 带 Z 的 UTC → 转本机时区后的墙钟（unchanged ndt 由调用方经 local_ts 转毫秒）
    if v.ends_with('Z') && !date_only {
        let utc = ndt.and_utc().with_timezone(&Local).naive_local();
        return Some((utc, date_only));
    }
    Some((ndt, date_only))
}

/// 本地墙钟 → 毫秒（TZID 按本机时区解读）
fn local_ts(ndt: NaiveDateTime) -> i64 {
    chrono::Local
        .from_local_datetime(&ndt)
        .earliest()
        .unwrap_or_else(|| chrono::Local.timestamp_opt(0, 0).earliest().unwrap())
        .timestamp_millis()
}

/// ICS 文本转义还原：\\ → \，\, → ,，\; → ;，\n → 换行
fn un_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some('\\') => out.push('\\'),
                Some(',') => out.push(','),
                Some(';') => out.push(';'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// 入库入口（仅测试/无源导入用；正式导入走 command 的按源管理）
#[cfg(test)]
pub fn import_ics_text(db: &CalendarDb, text: &str) -> Result<ImportReport, String> {
    let parsed = parse_ics(text);
    db.insert_imported(&parsed.items, None)?;
    Ok(ImportReport {
        events: parsed.events,
        instances: parsed.items.len(),
        repeated: parsed.repeated,
        skipped: parsed.skipped,
        unsupported: parsed.unsupported,
    })
}

// ---------- 导出与 JSON 备份 ----------

fn ics_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}

/// 行折叠：按 ≤60 字符切（避开 UTF-8 边界问题），续行以空格开头
fn fold_line(line: &str, out: &mut String) {
    let mut i = 0;
    loop {
        let end = (i + 60).min(line.chars().count());
        let chunk: String = line.chars().skip(i).take(end - i).collect();
        if chunk.is_empty() {
            break;
        }
        if i == 0 {
            out.push_str(&chunk);
        } else {
            out.push_str(&format!("\r\n {}", chunk));
        }
        i = end;
        if i >= line.chars().count() {
            break;
        }
    }
    out.push_str("\r\n");
}

fn local_stamp(ms: i64) -> String {
    let d = Local.timestamp_millis_opt(ms).earliest().unwrap();
    d.format("%Y%m%dT%H%M%S").to_string()
}

fn local_date(ms: i64) -> String {
    let d = Local.timestamp_millis_opt(ms).earliest().unwrap();
    d.format("%Y%m%d").to_string()
}

/// 导出 ICS（VEVENT 含规则与 EXDATE 删除型例外、编辑型例外转独立 VEVENT、VTODO）
pub fn export_ics_text(db: &CalendarDb) -> String {
    use super::db::Event;
    let mut out = String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//EasyTool//Calendar//CN\r\n");
    let now_utc = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let events = db.all_events().unwrap_or_default();
    let ovs = db.all_overrides().unwrap_or_default();
    let deletes: HashMap<i64, Vec<String>> = ovs
        .iter()
        .filter(|o| o.variant == "delete")
        .fold(HashMap::new(), |mut m, o| {
            m.entry(o.event_id).or_default().push(local_stamp(o.start_ms.unwrap_or(0)));
            m
        });

    let push_event = |out: &mut String, e: &Event| {
        let uid = format!("easytool-event-{}", e.id);
        fold_line("BEGIN:VEVENT", out);
        fold_line(&format!("UID:{}", uid), out);
        fold_line(&format!("DTSTAMP:{}", now_utc), out);
        fold_line(&format!("SUMMARY:{}", ics_escape(&e.title)), out);
        if !e.location.is_empty() {
            fold_line(&format!("LOCATION:{}", ics_escape(&e.location)), out);
        }
        if !e.notes.is_empty() {
            fold_line(&format!("DESCRIPTION:{}", ics_escape(&e.notes)), out);
        }
        if e.all_day {
            fold_line(&format!("DTSTART;VALUE=DATE:{}", local_date(e.start_ms)), out);
            fold_line(&format!("DTEND;VALUE=DATE:{}", local_date(e.end_ms)), out);
        } else {
            fold_line(&format!("DTSTART:{}", local_stamp(e.start_ms)), out);
            fold_line(&format!("DTEND:{}", local_stamp(e.end_ms)), out);
        }
        if let Some(rule) = &e.rrule {
            fold_line(&format!("RRULE:{}", rule), out);
            if let Some(list) = deletes.get(&e.id) {
                fold_line(&format!("EXDATE:{}", list.join(",")), out);
            }
        }
        fold_line("END:VEVENT", out);
    };

    for e in &events {
        push_event(&mut out, e);
    }
    // 编辑型例外 → 独立 VEVENT（保留该次改后的时间/字段）
    for o in &ovs {
        if o.variant != "edit" {
            continue;
        }
        let uid = format!("easytool-instance-{}-{}", o.event_id, o.instance_date);
        fold_line("BEGIN:VEVENT", &mut out);
        fold_line(&format!("UID:{}", uid), &mut out);
        fold_line(&format!("DTSTAMP:{}", now_utc), &mut out);
        fold_line(
            &format!(
                "SUMMARY:{}",
                ics_escape(o.title.as_deref().unwrap_or("日程"))
            ),
            &mut out,
        );
        if let Some(s) = o.start_ms {
            fold_line(&format!("DTSTART:{}", local_stamp(s)), &mut out);
        }
        if let Some(e2) = o.end_ms {
            fold_line(&format!("DTEND:{}", local_stamp(e2)), &mut out);
        }
        fold_line("END:VEVENT", &mut out);
    }
    if let Ok(todos) = db.all_todos() {
        for t in &todos {
            fold_line("BEGIN:VTODO", &mut out);
            fold_line(&format!("UID:easytool-todo-{}", t.id), &mut out);
            fold_line(&format!("DTSTAMP:{}", now_utc), &mut out);
            fold_line(&format!("SUMMARY:{}", ics_escape(&t.title)), &mut out);
            if !t.notes.is_empty() {
                fold_line(&format!("DESCRIPTION:{}", ics_escape(&t.notes)), &mut out);
            }
            if let Some(d) = t.due_date {
                fold_line(&format!("DUE;VALUE=DATE:{:08}", d), &mut out);
            }
            if t.done {
                fold_line("STATUS:COMPLETED", &mut out);
            }
            fold_line("END:VTODO", &mut out);
        }
    }
    out.push_str("END:VCALENDAR\r\n");
    out
}

/// JSON 备份文档结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonEvent {
    pub id: i64,
    pub title: String,
    pub location: String,
    pub notes: String,
    pub all_day: bool,
    pub start_ms: i64,
    pub end_ms: i64,
    pub rrule: Option<String>,
    pub created_ms: i64,
    pub updated_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonOverride {
    pub event_id: i64,
    pub instance_date: i64,
    pub variant: String,
    pub title: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub all_day: Option<bool>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonTodo {
    pub id: i64,
    pub title: String,
    pub notes: String,
    pub due_date: Option<i64>,
    pub done: bool,
    pub done_at_ms: Option<i64>,
    pub created_ms: i64,
    pub updated_ms: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonDoc {
    pub exported_at: String,
    pub events: Vec<JsonEvent>,
    pub overrides: Vec<JsonOverride>,
    pub todos: Vec<JsonTodo>,
}

/// 导出 JSON 全量备份（事件/例外/待办）
pub fn export_json_text(db: &CalendarDb) -> String {
    let doc = JsonDoc {
        exported_at: chrono::Utc::now().to_rfc3339(),
        events: db
            .all_events()
            .unwrap_or_default()
            .into_iter()
            .map(|e| JsonEvent {
                id: e.id,
                title: e.title,
                location: e.location,
                notes: e.notes,
                all_day: e.all_day,
                start_ms: e.start_ms,
                end_ms: e.end_ms,
                rrule: e.rrule,
                created_ms: e.created_ms,
                updated_ms: e.updated_ms,
            })
            .collect(),
        overrides: db
            .all_overrides()
            .unwrap_or_default()
            .into_iter()
            .map(|o| JsonOverride {
                event_id: o.event_id,
                instance_date: o.instance_date,
                variant: o.variant,
                title: o.title,
                location: o.location,
                notes: o.notes,
                all_day: o.all_day,
                start_ms: o.start_ms,
                end_ms: o.end_ms,
            })
            .collect(),
        todos: db
            .all_todos()
            .unwrap_or_default()
            .into_iter()
            .map(|t| JsonTodo {
                id: t.id,
                title: t.title,
                notes: t.notes,
                due_date: t.due_date,
                done: t.done,
                done_at_ms: t.done_at_ms,
                created_ms: t.created_ms,
                updated_ms: t.updated_ms,
            })
            .collect(),
    };
    serde_json::to_string_pretty(&doc).unwrap_or_default()
}

/// JSON 导入结果统计
#[derive(Debug, Default, serde::Serialize)]
pub struct JsonImportReport {
    pub events: usize,
    pub overrides: usize,
    pub todos: usize,
    pub skipped: usize,
}

/// 恢复 JSON 备份：按「标题+开始时刻」去重跳过已有事件；例外经 id 映射接回；
/// 待办按标题去重。均为追加合并，不覆盖现有数据。
pub fn import_json_text(db: &CalendarDb, text: &str) -> Result<JsonImportReport, String> {
    let doc: JsonDoc = serde_json::from_str(text).map_err(|e| format!("JSON 解析失败：{e}"))?;
    let mut report = JsonImportReport::default();
    let existing_events: HashSet<(String, i64)> = db
        .all_events()
        .unwrap_or_default()
        .into_iter()
        .map(|e| (e.title, e.start_ms))
        .collect();
    let existing_todos: HashSet<String> = db
        .all_todos()
        .unwrap_or_default()
        .into_iter()
        .map(|t| t.title)
        .collect();
    let mut id_map: HashMap<i64, i64> = HashMap::new();
    let now = now_ms();
    for ev in &doc.events {
        if existing_events.contains(&(ev.title.clone(), ev.start_ms)) {
            report.skipped += 1;
            continue;
        }
        let e = Event {
            id: 0,
            title: ev.title.clone(),
            location: ev.location.clone(),
            notes: ev.notes.clone(),
            all_day: ev.all_day,
            start_ms: ev.start_ms,
            end_ms: ev.end_ms,
            rrule: ev.rrule.clone(),
            created_ms: ev.created_ms,
            updated_ms: now,
        };
        let new_id = db.insert_event(&e)?;
        id_map.insert(ev.id, new_id);
        report.events += 1;
    }
    for o in &doc.overrides {
        let Some(nid) = id_map.get(&o.event_id) else {
            report.skipped += 1;
            continue;
        };
        let payload = if o.variant == "edit" {
            Some(Event {
                id: 0,
                title: o.title.clone().unwrap_or_default(),
                location: o.location.clone().unwrap_or_default(),
                notes: o.notes.clone().unwrap_or_default(),
                all_day: o.all_day.unwrap_or(false),
                start_ms: o.start_ms.unwrap_or(0),
                end_ms: o.end_ms.unwrap_or(0),
                rrule: None,
                created_ms: now,
                updated_ms: now,
            })
        } else if o.start_ms.is_some() {
            // 删除型例外也尽量带回原时刻（ICS EXDATE 用）
            Some(Event {
                id: 0,
                title: String::new(),
                location: String::new(),
                notes: String::new(),
                all_day: false,
                start_ms: o.start_ms.unwrap_or(0),
                end_ms: 0,
                rrule: None,
                created_ms: now,
                updated_ms: now,
            })
        } else {
            None
        };
        db.upsert_override(*nid, o.instance_date, &o.variant, &payload)?;
        report.overrides += 1;
    }
    for t in &doc.todos {
        if existing_todos.contains(&t.title) {
            report.skipped += 1;
            continue;
        }
        db.insert_todo(&Todo {
            id: 0,
            title: t.title.clone(),
            notes: t.notes.clone(),
            due_date: t.due_date,
            done: t.done,
            done_at_ms: t.done_at_ms,
            created_ms: t.created_ms,
            updated_ms: now,
        })?;
        report.todos += 1;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Datelike, Local, TimeZone, Timelike};
    use std::path::Path;

    fn cal(events: &str) -> String {
        format!(
            "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//T//EN\nBEGIN:VTIMEZONE\nTZID:Asia/Shanghai\nEND:VTIMEZONE\n{}\nEND:VCALENDAR",
            events
        )
    }

    #[test]
    fn parse_tzid_local_rrule_expands() {
        let text = cal(
            "BEGIN:VEVENT\nDTSTAMP:20260714T201948Z\nUID:a\nSUMMARY:大学物理(2)\nDTSTART;TZID=Asia/Shanghai:20260915T083000\nDTEND;TZID=Asia/Shanghai:20260915T100500\nRRULE:FREQ=WEEKLY;UNTIL=20261228T160000Z;INTERVAL=1\nLOCATION:教1-333\nEND:VEVENT",
        );
        let r = parse_ics(&text);
        assert_eq!(r.events, 1);
        assert_eq!(r.repeated, 1);
        assert_eq!(r.unsupported, 0);
        assert!(r.items.len() >= 15, "9/15~12/28 每周约 16 次，实际 {}", r.items.len());
        assert_eq!(r.items[0].title, "大学物理(2)");
        let d0 = Local.timestamp_millis_opt(r.items[0].start_ms).earliest().unwrap();
        assert_eq!((d0.month(), d0.day(), d0.hour(), d0.minute()), (9, 15, 8, 30));
        assert_eq!(r.items[0].end_ms - r.items[0].start_ms, 95 * 60_000);
        // 相邻次间隔 7 天
        assert_eq!(r.items[1].start_ms - r.items[0].start_ms, 7 * 86_400_000);
    }

    #[test]
    fn unsupported_rule_falls_back_single() {
        let text = cal(
            "BEGIN:VEVENT\nSUMMARY:年度事件\nDTSTART;TZID=Asia/Shanghai:20260915T083000\nDTEND;TZID=Asia/Shanghai:20260915T100500\nRRULE:FREQ=YEARLY\nEND:VEVENT",
        );
        let r = parse_ics(&text);
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.unsupported, 1);
    }

    #[test]
    fn all_day_date_only() {
        let text = cal("BEGIN:VEVENT\nSUMMARY:全天生日\nDTSTART;VALUE=DATE:20260915\nEND:VEVENT");
        let r = parse_ics(&text);
        assert_eq!(r.items.len(), 1);
        assert!(r.items[0].all_day);
        assert_eq!(r.items[0].end_ms - r.items[0].start_ms, 86_400_000);
    }

    #[test]
    fn utc_z_converted_to_local() {
        let text = cal(
            "BEGIN:VEVENT\nSUMMARY:UTC事件\nDTSTART:20260915T003000Z\nDTEND:20260915T013000Z\nEND:VEVENT",
        );
        let r = parse_ics(&text);
        let d0 = Local.timestamp_millis_opt(r.items[0].start_ms).earliest().unwrap();
        assert_eq!((d0.hour(), d0.minute()), (8, 30)); // UTC 00:30 → 本机 08:30
    }

    #[test]
    fn escaped_text_unescaped() {
        let text = cal(
            "BEGIN:VEVENT\nSUMMARY:带\\,逗号和\\n换行\nDTSTART;TZID=Asia/Shanghai:20260915T090000\nDTEND;TZID=Asia/Shanghai:20260915T100000\nDESCRIPTION:第一行\\n第二行\\,带逗号\\;分号\nEND:VEVENT",
        );
        let r = parse_ics(&text);
        assert_eq!(r.items[0].title, "带,逗号和\n换行");
        assert!(r.items[0].notes.contains('\n'));
        assert!(r.items[0].notes.contains(",带逗号;分号"));
    }

    #[test]
    fn unescape_direct() {
        assert_eq!(un_escape("a\\nb\\,c\\;d"), "a\nb,c;d");
    }

    #[test]
    fn skip_bad_event_and_import_pipeline() {
        let text = cal(
            "BEGIN:VEVENT\nDTSTART;TZID=Asia/Shanghai:20260915T090000\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:好事件\nDTSTART;TZID=Asia/Shanghai:20260916T090000\nDTEND;TZID=Asia/Shanghai:20260916T100000\nEND:VEVENT",
        );
        let r = parse_ics(&text);
        assert_eq!(r.skipped, 1);
        assert_eq!(r.items.len(), 1);
        let db = CalendarDb::open(Path::new(":memory:")).unwrap();
        let report = import_ics_text(&db, &text).unwrap();
        assert_eq!(report.events, 1);
        assert_eq!(report.instances, 1);
        assert_eq!(db.events_in_window(0, 9_000_000_000_000).unwrap().len(), 1);
    }

    #[test]
    fn export_and_json_roundtrip() {
        let db = CalendarDb::open(Path::new(":memory:")).unwrap();
        // 一条重复规则（每周一三五）+ 一条单次 + 一条待办
        let mut weekly = Event {
            id: 0,
            title: "每周例会".into(),
            location: "会议室".into(),
            notes: "带笔记本".into(),
            all_day: false,
            start_ms: 0,
            end_ms: 0,
            rrule: Some("FREQ=WEEKLY;BYDAY=MO,WE,FR".into()),
            created_ms: 0,
            updated_ms: 0,
        };
        weekly.start_ms = day_of(2026, 9, 15, 9, 0); // 周二
        weekly.end_ms = weekly.start_ms + 3600_000;
        let w_id = db.insert_event(&weekly).unwrap();
        let single = Event {
            id: 0,
            title: "看牙".into(),
            location: String::new(),
            notes: String::new(),
            all_day: false,
            start_ms: day_of(2026, 9, 30, 14, 0),
            end_ms: day_of(2026, 9, 30, 15, 0),
            rrule: None,
            created_ms: 0,
            updated_ms: 0,
        };
        db.insert_event(&single).unwrap();
        // 仅此一次删除：9/18（周五）那次
        db.insert_delete_override(w_id, 20260918, day_of(2026, 9, 18, 9, 0)).unwrap();
        db.insert_todo(&Todo {
            id: 0,
            title: "交周报".into(),
            notes: String::new(),
            due_date: Some(20261001),
            done: false,
            done_at_ms: None,
            created_ms: 0,
            updated_ms: 0,
        })
        .unwrap();

        // ICS 导出 → 能再解析出内容（规则事件含 RRULE、删除型变成 EXDATE、单次与待办都在）
        let ics = export_ics_text(&db);
        assert!(ics.contains("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"));
        assert!(ics.contains("EXDATE:"));
        assert!(ics.contains("BEGIN:VTODO"));
        assert!(ics.contains("SUMMARY:看牙"));
        let reparsed = parse_ics(&ics);
        assert_eq!(reparsed.events, 2); // 规则 VEVENT + 单次 VEVENT（待办不计入 events）
        assert!(reparsed.items.len() >= 3); // 展开出的多次 + 单次（注：EXDATE 删除型暂不参与解析）

        // JSON 导出 → 导入到空库 → 数量吻合；再导一次全跳过
        let json = export_json_text(&db);
        let db2 = CalendarDb::open(Path::new(":memory:")).unwrap();
        let r1 = import_json_text(&db2, &json).unwrap();
        assert_eq!(r1.events, 2);
        assert_eq!(r1.overrides, 1);
        assert_eq!(r1.todos, 1);
        assert_eq!(r1.skipped, 0);
        assert_eq!(db2.all_todos().unwrap().len(), 1);
        assert_eq!(db2.all_overrides().unwrap().len(), 1);
        let r2 = import_json_text(&db2, &json).unwrap();
        assert_eq!(r2.events, 0);
        assert_eq!(r2.todos, 0);
        assert_eq!(r2.skipped, 4); // 2 事件 + 1 待办按去重跳过 + 1 例外因事件未重导入而跳过
    }

    fn day_of(y: i32, m: u32, d: u32, h: u32, mi: u32) -> i64 {
        let ndt = chrono::NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, mi, 0)
            .unwrap();
        Local.from_local_datetime(&ndt).earliest().unwrap().timestamp_millis()
    }

    /// 真实文件校验（默认忽略；设 EASYTOOL_ICS_FIXTURE 指向 .ics 路径后运行）
    #[test]
    #[ignore = "需要真实文件路径（EASYTOOL_ICS_FIXTURE）"]
    fn real_ics_fixture_imports() {
        let path = std::env::var("EASYTOOL_ICS_FIXTURE").expect("EASYTOOL_ICS_FIXTURE 未设置");
        let text = std::fs::read_to_string(&path).expect("读取文件失败");
        let r = parse_ics(&text);
        assert!(r.events > 0, "应解析出至少 1 个事件");
        assert_eq!(r.skipped, 0, "真实文件不应有坏条目");
        let db = CalendarDb::open(Path::new(":memory:")).unwrap();
        let report = import_ics_text(&db, &text).unwrap();
        eprintln!(
            "真实文件导入：VEVENT={} 实例总数(物化后)={} 重复事件={} 不支持={} 跳过={}",
            report.events, report.instances, report.repeated, report.unsupported, report.skipped
        );
    }
}