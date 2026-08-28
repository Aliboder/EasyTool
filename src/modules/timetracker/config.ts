export interface TimetrackerConfig {
  trackWindowTitle: boolean;
  /** 用户无输入超过该秒数判定离开（AFK），不计活跃时长；0 = 关闭检测 */
  afkThresholdSec: number;
  /** 系统有非静音声音播放时不算离开（看视频/直播/听音乐豁免挂机判定） */
  mediaPlayingActive: boolean;
  topN: number;
}

export const TIMETRACKER_DEFAULTS: TimetrackerConfig = {
  trackWindowTitle: true,
  afkThresholdSec: 120,
  mediaPlayingActive: false,
  topN: 10,
};
