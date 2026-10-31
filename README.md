# Recipe

一个用 [Astro](https://astro.build) 构建的静态食谱网站，纯静态输出，计划部署在 GitHub Pages。

- 线上地址（待部署）：<https://yushanfans2233.github.io/recipe/>
- 仓库：<https://github.com/yushanfans2233/recipe>

## 技术栈

| 技术                                                       | 版本         | 用途               |
| ---------------------------------------------------------- | ------------ | ------------------ |
| [Node.js](https://nodejs.org)                              | 26.13.0 本地 | 运行环境（≥22.23.4）|
| [Astro](https://astro.build)                               | 7.4.4        | 静态站点框架       |
| [TypeScript](https://www.typescriptlang.org)               | 6.0.3        | 类型检查（strict） |
| [Tailwind CSS](https://tailwindcss.com)                    | 4.3.3        | 样式               |
| [@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/) | 3.7.4 | sitemap 生成 |

> 说明：`@astrojs/check` 目前只支持 TypeScript 5/6，所以 TypeScript 固定在最新的 6.x，而不是 npm 上最新的 7.x。

## 本地开发

```bash
npm install     # 安装依赖
npm run dev     # 开发服务器 http://localhost:4321/
npm run build   # 构建静态文件到 dist/
npm run preview # 预览构建结果
npm run check   # TypeScript / Astro 类型检查
```

## 目录结构

```
recipe/
├── .github/workflows/deploy.yml  # 部署到 GitHub Pages 的工作流
├── public/                       # 原样拷贝到输出根目录的静态资源
│   └── favicon.svg
├── src/
│   ├── layouts/BaseLayout.astro  # 全站 HTML 骨架、SEO meta
│   ├── pages/index.astro         # 首页
│   ├── styles/global.css         # Tailwind 入口与全局样式
│   └── utils/url.ts              # 拼接带 base 的站内链接
├── astro.config.mjs              # site / base / 集成配置
├── tsconfig.json
└── package.json
```

## 关于 base

GitHub Pages 的项目站点会部署在 `/<repo>/` 下，所以 `astro.config.mjs` 里配置了：

```js
site: 'https://yushanfans2233.github.io',
base: '/recipe',
```

因此站内链接不能直接写 `/about`，否则会跳到域名根目录。请统一用 `src/utils/url.ts` 的 `url()`：

```astro
---
import { url } from '../utils/url';
---

<a href={url('/about')}>关于</a>
<!-- 输出 href="/recipe/about" -->
```

以后绑定自定义域名时：把 `site` 改成域名、删掉 `base`，再把 `url()` 换成普通路径即可，其余不用动。

## 部署到 GitHub Pages

工作流 `.github/workflows/deploy.yml` 已经写好，但目前**只配置了手动触发**（`workflow_dispatch`），避免 GitHub Pages 还没开通时每次推送都产生失败的运行。

正式开通时：

1. 打开仓库 **Settings → Pages**，把 **Source** 设为 **GitHub Actions**。
2. 打开 `.github/workflows/deploy.yml`，取消 `push: branches: [main]` 两行的注释。
3. 推送后，站点会发布到 <https://yushanfans2233.github.io/recipe/>。

（这两步也可以直接让我来做。）
