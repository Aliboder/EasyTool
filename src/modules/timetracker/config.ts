export interface TimetrackerConfig {
  trackWindowTitle: boolean;
  /** 用户无输入超过该秒数判定离开（AFK），不计活跃时长；0 = 关闭检测 */
  afkThresholdSec: number;
  topN: number;
  hotkey: string;
}

export const TIMETRACKER_DEFAULTS: TimetrackerConfig = {
  trackWindowTitle: true,
  afkThresholdSec: 120,
  topN: 10,
  hotkey: "Ctrl+Shift+T",
};
