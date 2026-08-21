# Vite + React + GitHub Pages 部署指南

> 供 AI Agent 复用的标准化流程。适用于 Vite + React + Tailwind 单页应用部署到 GitHub Pages。

## 技术栈

- Vite 6+（构建工具）
- React 19+（UI 框架）
- TypeScript
- Tailwind CSS v4（样式）

## 目录结构

```
project/
├── .github/workflows/deploy.yml   # GitHub Actions 自动部署
├── src/
│   ├── main.tsx                    # 入口
│   ├── App.tsx                     # 根组件
│   └── index.css                   # 全局样式（@import "tailwindcss"）
├── index.html                      # HTML 模板
├── vite.config.ts                  # Vite 配置
├── tsconfig.json
└── package.json
```

## 步骤 1：初始化项目

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install -D tailwindcss @tailwindcss/vite
```

## 步骤 2：Vite 配置

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",  // 相对路径，兼容 GitHub Pages 子目录
});
```

**关键**：`base: "./"` 使用相对路径，部署到 `https://user.github.io/repo/` 时资源路径自动正确。

## 步骤 3：Tailwind 配置

```css
/* src/index.css */
@import "tailwindcss";
```

## 步骤 4：GitHub Actions 部署文件

```yaml
# .github/workflows/deploy.yml
name: Deploy Website

on:
  push:
    branches: [main]  # 或 master
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

## 步骤 5：GitHub 仓库设置

### 启用 GitHub Pages

```bash
# 方式一：通过 gh CLI（推荐）
gh api repos/{owner}/{repo}/pages -X POST -f build_type=workflow

# 方式二：手动
# 仓库 Settings → Pages → Source → GitHub Actions
```

### 推送代码触发部署

```bash
git add .
git commit -m "feat: initial website"
git push origin main
```

## 步骤 6：验证

```bash
# 查看部署状态
gh run list --workflow=deploy.yml --limit 1

# 验证网站可访问
curl -I https://user.github.io/repo/
# 应返回 200
```

## 常见问题

### 构建成功但 404

**原因**：`base` 配置错误。
**解决**：`vite.config.ts` 中 `base: "./"`（相对路径）或 `base: "/repo-name/"`（绝对路径）。

### 部署后样式/JS 加载失败

**原因**：`base` 路径不匹配。
**解决**：GitHub Pages 子路径必须与仓库名一致。

### `npm ci` 超时

**原因**：网络问题或 package-lock.json 不同步。
**解决**：删除 `node_modules` 和 `package-lock.json`，重新 `npm install`。

### 部署 workflow 不触发

**原因**：Pages 未启用或权限不足。
**解决**：确认 Settings → Pages → Source 已设为 GitHub Actions。

### 首次部署后页面空白

**原因**：`dist/` 目录为空或入口文件错误。
**解决**：本地运行 `npm run build` 检查 `dist/` 内容。

## 本地预览

```bash
# 开发模式（热重载）
npm run dev

# 预览构建产物（模拟线上）
npm run build && npm run preview
```

## 带版本号的发布

```bash
# 1. 改版本号（三处同步）
# package.json → version
# vite.config.ts → define（如有）

# 2. 提交并打 tag
git tag v1.0.0
git push origin main --tags

# 3. 创建 GitHub Release（触发额外的 Release artifact）
gh release create v1.0.0 --title "v1.0.0" --notes "Initial release"
```

## 目录模板

需要快速创建时，直接复制以下文件结构：

### package.json

```json
{
  "name": "my-website",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

### index.html

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Website</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### src/main.tsx

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### src/App.tsx

```tsx
export default function App() {
  return <div className="min-h-screen bg-zinc-950 text-white">Hello World</div>;
}
```

### src/index.css

```css
@import "tailwindcss";
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

---

*生成于 2026-08-21，基于 EasyTool 官网项目的实际部署经验。*
