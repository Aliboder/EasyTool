// 表情模块配置：前端 state 用 camelCase，config.json 存储键自动转 snake_case（由 useModuleConfig 处理）
export interface EmojiConfig {
  hotkey: string;
  clickAction: "paste" | "copy";
  followMouse: boolean;
  emojiGridSize: number;
  customGridSize: number;
}

export const EMOJI_DEFAULTS: EmojiConfig = {
  hotkey: "Ctrl+Shift+J",
  clickAction: "paste",
  followMouse: true,
  emojiGridSize: 40,
  customGridSize: 56,
};
