import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const recipes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/recipes' }),
  schema: () =>
    z.object({
      /** 菜名，来自文件名 */
      title: z.string(),
      /** 分类目录：蛋白质 / 蔬菜 / 主食 */
      category: z.string(),
      /** 分类内的顺序，由同步脚本写入 */
      order: z.number().default(0),
      /** 除 receipt 之外的 Obsidian 标签 */
      tags: z.array(z.string()).default([]),
      /** 封面图文件名，对应 src/assets/recipes/ 下的 WebP */
      cover: z.string().optional(),
    }),
});

export const collections = { recipes };
