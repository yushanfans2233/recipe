# 菜单 · Recipe

一个用 [Astro](https://astro.build) 构建的静态食谱网站：手写工作纸风格（暖色纸张、手写字体、贴纸式照片），首页展示全部菜品的图片与名字，点开查看食材清单与制作步骤。

- 线上地址（待部署）：<https://yushanfans2233.github.io/recipe/>
- 仓库：<https://github.com/yushanfans2233/recipe>

## 技术栈

| 技术 | 版本 | 用途 |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 26.13.0 本地 | 运行环境（≥22.23.4） |
| [Astro](https://astro.build) | 7.4.4 | 静态站点框架 |
| [TypeScript](https://www.typescriptlang.org) | 6.0.3 | 类型检查（strict） |
| [Tailwind CSS](https://tailwindcss.com) | 4.3.3 | 样式 |
| [@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/) | 3.7.4 | sitemap 生成 |
| [sharp](https://sharp.pixelplumbing.com) | 0.35.5 | 同步时压缩封面图 |
| [subset-font](https://github.com/papandreou/subset-font) | 2.9.0 | 中文字体子集化 |

> `@astrojs/check` 目前只支持 TypeScript 5/6，所以 TypeScript 固定在最新的 6.x，而不是 npm 上最新的 7.x。

## 本地开发

```bash
npm install     # 安装依赖
npm run dev     # 开发服务器 http://localhost:4321/recipe/
npm run build   # 构建静态文件到 dist/
npm run preview # 预览构建结果
npm run check   # TypeScript / Astro 类型检查
npm run sync    # 从 Obsidian 菜谱库同步内容与图片
npm run fonts   # 按站点用字重新生成字体子集（新增菜谱后用）
```

## 内容来源

菜谱写在 Obsidian 里，站点不直接读取 Obsidian，而是用 `npm run sync` 把内容搬进仓库：

```
Obsidian 菜谱库（源）                     站点（产物，需要提交）
C:/Users/32347/OneDrive/文档/obsidian/菜单/
├── 菜谱库/蛋白质|蔬菜|主食/*.md   ──sync──▶  src/content/recipes/*.md
└── 图片/*.png|jpg                ──sync──▶  src/assets/recipes/*.webp
```

同步脚本 `scripts/sync-content.mjs` 会做这些事：

- 读取 frontmatter 的 `cover`、`tags`，分类取所在文件夹名（蛋白质 / 蔬菜 / 主食）
- 生成站点用的 frontmatter：`title`、`category`、`order`、`tags`、`cover`（图片文件名）
- 把 Obsidian 语法转成标准 Markdown：删掉 `%% 注释 %%` 和 `![[图片]]` 嵌入，`[[#标题]]` 转成页内锚点，断链（如 `[[面粉小知识]]`）降级成纯文本
- 标题层级统一：源文件里 `#` / `##` / `####` 混用，按实际深度重排成从 h2 开始
- 封面图压成 WebP（最长边 1600px，质量 82），26 张原图 48MB → 约 1.8MB
- 跳过空文件（目前是 `辣白菜嫩豆腐汤.md`）

改了 Obsidian 里的菜谱之后，跑一次 `npm run sync`，然后提交 `src/content` 和 `src/assets` 的变更即可。源目录可以用环境变量覆盖：

```bash
RECIPE_VAULT="D:/其他路径/菜谱库" RECIPE_IMAGES="D:/其他路径/图片" npm run sync
```

## 目录结构

```
recipe/
├── .github/workflows/deploy.yml   # 部署到 GitHub Pages 的工作流
├── public/favicon.svg
├── scripts/
│   ├── sync-content.mjs           # Obsidian → 站点 同步脚本
│   └── build-fonts.mjs            # 手写字体子集化
├── src/
│   ├── assets/deco/               # 手绘线条、纸纹（SVG）
│   ├── assets/fonts/              # 子集化后的 woff2（提交）
│   ├── assets/recipes/            # 同步生成的封面图（WebP，提交）
│   ├── components/PencilArrow.astro
│   ├── content/recipes/           # 同步生成的 Markdown（提交）
│   ├── layouts/BaseLayout.astro   # 全站骨架、SEO meta
│   ├── lib/recipes.ts             # 取菜谱、排序、封面图、详情页地址
│   ├── pages/
│   │   ├── index.astro            # 首页：分类筛选 + 图片墙
│   │   ├── [slug].astro           # 菜谱详情页
│   │   └── 404.astro
│   ├── styles/global.css          # 设计令牌、纸张质感、正文排版
│   ├── utils/url.ts               # 拼接带 base 的站内链接
│   └── content.config.ts          # 内容集合 schema
├── astro.config.mjs
└── package.json
```

## 视觉风格

整体是一张手写工作纸：暖色纸底（`--dp-color-ground`）、铅灰墨色、蓝色批注、红色强调、黄色荧光笔。

- 设计令牌集中在 `src/styles/global.css` 的 `:root` 里，改颜色 / 字号 / 控件圆角只需改这一处。
- 标题用「站酷快乐体」，正文用「霞鹜文楷」，都以 `@font-face` 别名为 `Sketch Working Marker` / `Sketch Working Hand` 自托管，不依赖任何境外 CDN（Google Fonts 在国内会被墙）。
- 中文手写字体原文件有 25MB+，所以按站点实际用字做了子集化：正文 228KB、标题 104KB。**新增菜谱后如果出现个别字回退成系统字体，跑一次 `npm run fonts` 重新生成即可。**
- 封面照片保持自然彩色，放在贴了胶带的纸板上，轻微倾斜；悬停时照片框回正、阴影加深。
- 装饰（胶带、箭头、波浪线）都是 `aria-hidden`，不影响读屏与阅读顺序，也不参与键盘焦点。

## 关于 base

GitHub Pages 的项目站点会部署在 `/<repo>/` 下，所以 `astro.config.mjs` 里配置了：

```js
site: 'https://yushanfans2233.github.io',
base: '/recipe',
```

站内链接统一用 `src/utils/url.ts` 的 `url()`；菜谱详情页地址用 `src/lib/recipes.ts` 的 `recipeUrl()`（内部已经拼好 base 与 URL 编码）。以后换自定义域名时：把 `site` 改成域名、删掉 `base`，其余不用动。

## 部署到 GitHub Pages

工作流 `.github/workflows/deploy.yml` 已经写好，但目前**只配置了手动触发**（`workflow_dispatch`），避免 GitHub Pages 还没开通时每次推送都产生失败的运行。

正式开通时：

1. 打开仓库 **Settings → Pages**，把 **Source** 设为 **GitHub Actions**。
2. 打开 `.github/workflows/deploy.yml`，取消 `push: branches: [main]` 两行的注释。
3. 推送后，站点会发布到 <https://yushanfans2233.github.io/recipe/>。

（这两步也可以直接让我来做。）
