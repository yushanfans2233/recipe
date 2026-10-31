// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages 的项目站点地址形如 https://<username>.github.io/<repo>/
// 这个仓库叫 recipe，所以站点根路径是 /recipe。
// 以后绑定自定义域名时：把 site 改成 `https://你的域名`，并删掉 base 这一行。
const SITE = 'https://yushanfans2233.github.io';
const BASE = '/recipe';

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    // 预览页不进 sitemap
    sitemap({ filter: (page) => !page.includes('/preview/') }),
  ],
  markdown: {
    // 菜谱里不需要代码高亮
    syntaxHighlight: false,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
