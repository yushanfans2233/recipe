/**
 * 站内路径拼接工具。
 *
 * GitHub Pages 的项目站点会部署在 `/<repo>/` 下（这里 base 是 `/recipe`），
 * 所以页面里的站内链接不能直接写 `/about`，否则会跳到域名根目录。
 * 统一用 `url('/about')` 生成 `/recipe/about`，以后换自定义域名只需改 astro.config.mjs。
 */
const BASE = import.meta.env.BASE_URL;

export function url(path = '/'): string {
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  const suffix = path.startsWith('/') ? path : `/${path}`;

  return `${base}${suffix}` || '/';
}
