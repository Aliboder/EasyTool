import { defineConfig } from "vitest/config";

// 前端单测配置（独立于 vite.config.ts 的 Tauri/MPA 构建配置）
// 运行：npm test（vitest run）
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});