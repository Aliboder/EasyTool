// EasyAsk 模块配置：前端 state 用 camelCase，config.json 存储键自动转 snake_case（由 useModuleConfig 处理）
export interface EasyaskProvider {
  id: string;
  name: string;
  url: string;
}

export interface EasyaskConfig {
  providers: EasyaskProvider[];
  /** 当前选中的 AI（顶栏切换时保存，重启后打开它） */
  activeProvider: string | null;
}

export const EASYASK_DEFAULTS: EasyaskConfig = {
  providers: [
    { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/" },
    { id: "kimi", name: "Kimi", url: "https://kimi.moonshot.cn/" },
    { id: "tongyi", name: "通义千问", url: "https://tongyi.aliyun.com/" },
    { id: "doubao", name: "豆包", url: "https://www.doubao.com/chat/" },
  ],
  activeProvider: "deepseek",
};
