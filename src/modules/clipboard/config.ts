// 剪贴板模块配置：前端 state 用 camelCase，config.json 存储键自动转 snake_case（由 useModuleConfig 处理）
export interface ClipboardConfig {
  maxItems: number;
  hotkey: string;
  followMouse: boolean;
  recordText: boolean;
  recordImage: boolean;
  recordFiles: boolean;
  minTextLen: number;
  cellSize: number;
  textLines: number;
  showTimestamps: boolean;
  popupSize?: unknown;
}

export const CLIPBOARD_DEFAULTS: ClipboardConfig = {
  maxItems: 500,
  hotkey: "Ctrl+Shift+V",
  followMouse: true,
  recordText: true,
  recordImage: true,
  recordFiles: true,
  minTextLen: 0,
  cellSize: 80,
  textLines: 2,
  showTimestamps: true,
};
