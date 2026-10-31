import { getCollection, type CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import { url } from '../utils/url';

/** 首页分类的展示顺序 */
export const CATEGORY_ORDER = ['蛋白质', '蔬菜', '主食'];

export type Recipe = CollectionEntry<'recipes'>;

const coverModules = import.meta.glob<{ default: ImageMetadata }>('../assets/recipes/*.webp', {
  eager: true,
});

const covers = new Map<string, ImageMetadata>(
  Object.entries(coverModules).map(([filePath, module]) => [filePath.split('/').pop() ?? '', module.default]),
);

/** 按 frontmatter 里的文件名取封面图（构建期解析，交给 astro:assets 优化） */
export function coverFor(fileName: string | undefined): ImageMetadata | undefined {
  return fileName ? covers.get(fileName) : undefined;
}

function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/** 取全部菜谱，顺序与同步脚本一致：分类 → 分类内顺序 */
export async function getRecipes(): Promise<Recipe[]> {
  const recipes = await getCollection('recipes');

  return recipes.sort((a, b) => {
    const rank = categoryRank(a.data.category) - categoryRank(b.data.category);
    if (rank !== 0) return rank;
    if (a.data.order !== b.data.order) return a.data.order - b.data.order;
    return a.id.localeCompare(b.id, 'zh-Hans-CN');
  });
}

/** 菜谱详情页地址（已带上部署用的 base） */
export function recipeUrl(id: string): string {
  return url(`/${encodeURIComponent(id)}/`);
}
