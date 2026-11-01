# 菜单 · recipe

把 Obsidian 里的菜谱库变成可以随时翻看的静态网站。

- 线上：<https://yushanfans2233.github.io/recipe/>
- 菜谱数量：25 道（蛋白质 9 · 蔬菜 8 · 主食 8）
- 技术栈：Astro 7 + Tailwind CSS 4 + TypeScript，部署在 GitHub Pages

## 目录结构

```
scripts/
  sync-content.mjs      Obsidian → 站点内容（含校验、图片压缩、字体重建、指纹）
  normalize-vault.mjs   一次性把历史写法统一成受控词表（默认 dry-run）
  build-fonts.mjs       按实际用字裁剪字体子集
  check-fonts.mjs       校验字体是否覆盖当前所有用字
  check-sync.mjs        校验站点内容是否落后于 Obsidian
  lib/vault-state.mjs   源目录指纹（同步与校验共用）

src/
  content/recipes/      同步产物（不要手改）
  assets/recipes/       压缩后的封面图（不要手改）
  components/RecipeView.astro   详情页主体
  lib/recipe-html.ts    把渲染后的 HTML 切成 食材 / 步骤 / TIPS
  lib/recipe-parse.ts   从 Markdown 取食材与步骤（搜索、结构化数据用）
  pages/index.astro     首页（分类筛选 + 按食材搜索）
  pages/[slug].astro    详情页（含 Recipe JSON-LD）
  pages/add.astro       网页版添加菜谱（导出 Markdown + 压缩图）

recipes-src/            Obsidian 原文镜像（版本历史用，不参与构建）
```

## 菜谱写法（受控词表）

菜谱库是唯一真源，写法必须固定，否则同步会报错：

```markdown
---
cover: "[[白灼菜心.png]]"
category: "蔬菜"
tags:
  - "素菜"
---

## 食材

### 主食材

| 食材 | 数量 |
| --- | --- |
| 菜心 | 500g |

### 调味

| 调味 | 数量 |
| --- | --- |
| 生抽 | 4勺 |

## 制作

### 备菜

1. 摘除菜心老叶。

### 焯烫菜心

1. 锅中加半锅清水。

## TIPS

1. 白灼汁加少量洋葱丁更香。
```

规则：

| 段落 | 只认这一个写法 |
| --- | --- |
| 食材 | `## 食材`（不要写「食材清单」「购物清单」「材料」） |
| 制作 | `## 制作`（不要写「制作流程」「做法」「步骤」） |
| 提示 | `## TIPS` |
| 步骤 | `### 步骤名`（每步一个 H3） |
| 分组 | `### 主食材`、`### 调味` 等 |

- 正文从 `##` 开始，**不要写 H1**（菜名由文件名承担）
- 封面图与 md 同名，放在 `图片/` 目录
- 分类、标签优先读 frontmatter，缺省时按所在文件夹归类
- 新建菜谱用 Obsidian 模板：`模板/菜谱模板.md`

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地开发 |
| `npm run sync` | 从 Obsidian 同步内容 + 图片 + 字体，带校验 |
| `npm run normalize` | 把历史写法批量规范化（默认 dry-run，加 `-- --apply` 才写入并备份） |
| `npm run fonts` | 重建字体子集 |
| `npm run check` | TypeScript / Astro 类型检查 |
| `npm run check:fonts` | 检查是否有字没被字体覆盖 |
| `npm run check:sync` | 检查线上内容是否落后于 Obsidian（`-- --strict` 退出码非零） |
| `npm run verify` | 类型 + 字体 + 过期 三项一起跑 |
| `npm run build` | 构建（构建前会自动跑字体检查） |

## 数据流

```
Obsidian 菜谱库 (OneDrive)
        │  npm run sync
        ├─→ src/content/recipes/*.md     规范化 + frontmatter（含总用时）
        ├─→ src/assets/recipes/*.webp     压缩封面（最长边 1600px，q82）
        ├─→ recipes-src/<分类>/*.md       原文镜像，进 git 留历史
        ├─→ src/assets/fonts/*.woff2      按当前用字重建子集
        └─→ .cache/sync-state.json        源目录指纹
        │  git push
        └─→ GitHub Actions（verify → build → deploy）
```

同步时会做的校验（不通过直接失败）：

- 每篇必须有 `## 食材`、`## 制作`，且 `## 制作` 下至少一个 `###`
- 菜名不能重复、不能为空文件
- 缺封面图、缺 `## 制作` 会在日志里提示（页面会回退成单栏）

## 添加菜谱

**方式一（推荐）**：Obsidian 里用 `模板/菜谱模板.md` 新建，填完跑 `npm run sync`。

**方式二**：打开 <https://yushanfans2233.github.io/recipe/add/> 填写，点「下载 Markdown」和「下载压缩图」，把文件放进菜谱库和图片目录，再 `npm run sync`。

> 网页版只在浏览器里生成文件，不会上传任何内容，也不需要 token。

## 视觉风格

手写纸感：暖纸底 `#f7f2e7`、墨色 `#38352f`、批注蓝 `#344c69`、强调红 `#9e3a2e`、荧光黄 `#f0dfa0`。
字体自托管（LXGW WenKai / ZCOOL KuaiLe 子集，共约 350KB），不依赖 Google Fonts。

详情页采用「步骤手册」版式：

- 顶部小图 + 菜名 + 步数 / 用时 / 标签
- 左侧食材常驻（手机端折叠成一栏，点开可见），右上角可一键复制食材
- 右侧按 `STEP 01/02/03` 分段，段内小圈号逐条编号
- 底部 TIPS 显示成虚线便签
- 输出 `Recipe` 结构化数据（JSON-LD）

## 已知情况

- `辣白菜嫩豆腐汤.md` 是空文件，同步时跳过
- `煎饼.md` 只有食材清单、没有制作段 → 详情页回退成单栏文章
- 分类以 frontmatter 的 `category` 为准，文件夹只是浏览习惯

## 部署

推送到 `main` 自动部署：

1. **verify**：`astro check` + 字体覆盖检查
2. **build**：`withastro/action`
3. **deploy**：`actions/deploy-pages`

仓库需在 Settings → Pages 里把 Source 设为「GitHub Actions」。
