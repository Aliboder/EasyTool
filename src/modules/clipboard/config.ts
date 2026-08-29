// 剪贴板模块配置：前端 state 用 camelCase，config.json 存储键自动转 snake_case（由 useModuleConfig 处理）
export interface ClipboardConfig {
  recordText: boolean;
  recordImage: boolean;
  recordFiles: boolean;
  minTextLen: number;
  cellSize: number;
  textLines: number;
  showTimestamps: boolean;
  /** 粘贴/复制文本时去掉富文本格式，只保留纯文本 */
  pastePlain: boolean;
}

export const CLIPBOARD_DEFAULTS: ClipboardConfig = {
  recordText: true,
  recordImage: true,
  recordFiles: true,
  minTextLen: 0,
  cellSize: 80,
  textLines: 2,
  showTimestamps: true,
  pastePlain: false,
};
