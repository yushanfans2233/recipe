import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

/** 食材清单之类的侧栏段落，按分组拆开便于横排 */
export interface SideSection {
  title: string;
  /** 每个分组（小标题 + 表格） */
  groups: string[];
}

/** 拆好的菜谱片段 */
export interface RecipeParts {
  /** 可以分栏排版 */
  ok: boolean;
  /** 侧栏：食材、调味（整段 HTML） */
  side: string[];
  /** 侧栏分段（便于横排分组） */
  sideSections: SideSection[];
  /** 侧栏：步骤-时间表 */
  schedule: string | null;
  /** 「制作流程」这个小标题 */
  processTitle: string;
  /** 每一步一个块（<div class="step-block">） */
  steps: string[];
  /** 其它没归类的小标题段落 */
  extras: string[];
  /** 结尾：TIPS */
  tips: string | null;
  /** 兼容旧版：processTitle + steps + extras 拼好的主栏 HTML */
  main: string;
}

const INGREDIENT_TITLE = /食材|配料|原料|购物|材料|用料/;
const PROCESS_TITLE = /制作|流程|步骤|做法|烹饪|操作/;
const TIPS_TITLE = /tips|提示|小贴士|贴士|注意/i;

interface Section {
  title: string;
  html: string;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 按指定标题层级把 HTML 切成 [{ title, html }] */
function splitByTag(html: string, tag: 'h2' | 'h3'): { preamble: string; sections: Section[] } {
  const chunks = html.split(new RegExp(`(?=<${tag}[\\s>])`)).filter(Boolean);
  const preamble = chunks.filter((chunk) => !chunk.startsWith(`<${tag}`)).join('');
  const sections: Section[] = [];

  for (const chunk of chunks) {
    if (!chunk.startsWith(`<${tag}`)) continue;
    const match = chunk.match(new RegExp(`^<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    if (!match) continue;
    sections.push({ title: plainText(match[1]), html: chunk.slice(match[0].length).trim() });
  }

  return { preamble, sections };
}

/** 把「h3 + 内容」包成一个个步骤块，方便用 CSS 多栏排 */
function wrapSteps(html: string): string[] {
  const { preamble, sections } = splitByTag(html, 'h3');
  const blocks: string[] = [];
  const rest = preamble.trim();
  if (rest) blocks.push(`<div class="step-block">${rest}</div>`);
  for (const section of sections) {
    blocks.push(`<div class="step-block"><h3>${section.title}</h3>${section.html}</div>`);
  }
  return blocks;
}

export function splitRecipeHtml(html: string): RecipeParts {
  const { preamble, sections } = splitByTag(html, 'h2');

  const side: string[] = [];
  const sideSections: SideSection[] = [];
  const tips: string[] = [];
  const extras: string[] = [];
  const stepBlocks: string[] = [];
  let schedule: string | null = null;
  let processTitle = '';

  for (const section of sections) {
    if (TIPS_TITLE.test(section.title)) {
      tips.push(`<h2>${section.title}</h2>${section.html}`);
      continue;
    }

    if (INGREDIENT_TITLE.test(section.title)) {
      // 「购物清单」这类标题下可能同时混着食材和做法，按 h3 再分一次
      const inner = splitByTag(section.html, 'h3');
      const keep: string[] = [];
      for (const sub of inner.sections) {
        if (PROCESS_TITLE.test(sub.title)) {
          stepBlocks.push(`<div class="step-block"><h3>${sub.title}</h3>${sub.html}</div>`);
        } else {
          keep.push(`<h3>${sub.title}</h3>${sub.html}`);
        }
      }
      const rest = [inner.preamble, ...keep].join('').trim();
      if (rest) {
        side.push(`<h2>${section.title}</h2>${rest}`);
        sideSections.push({
          title: section.title,
          groups: [
            inner.preamble.trim(),
            ...inner.sections
              .filter((sub) => !PROCESS_TITLE.test(sub.title))
              .map((sub) => `<div class="fact-group"><h3>${sub.title}</h3>${sub.html}</div>`),
          ].filter(Boolean),
        });
      }
      continue;
    }

    if (PROCESS_TITLE.test(section.title)) {
      processTitle = section.title;
      const inner = splitByTag(section.html, 'h3');
      const table = inner.preamble.match(/<table>[\s\S]*?<\/table>/)?.[0] ?? null;
      if (table && !schedule) schedule = table;

      // 从「步骤/时间」表里取出每一步的用时，卡片标题右上角要显示
      const times = new Map<string, string>();
      for (const row of table?.matchAll(/<tr>([\s\S]*?)<\/tr>/g) ?? []) {
        const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => plainText(cell[1]));
        if (cells.length >= 2 && cells[0] && cells[1]) times.set(cells[0], cells[1]);
      }

      const rest = inner.preamble.replace(/<table>[\s\S]*?<\/table>/, '').trim();
      if (rest) stepBlocks.push(`<div class="step-block">${rest}</div>`);
      for (const sub of inner.sections) {
        const time = times.get(sub.title);
        const label = `<span class="step-name">${sub.title}</span>${time ? `<span class="step-time">${time}</span>` : ''}`;
        stepBlocks.push(`<div class="step-block"><h3>${label}</h3>${sub.html}</div>`);
      }
      continue;
    }

    extras.push(`<h2>${section.title}</h2>${section.html}`);
  }

  // 没有 h2 的零散内容（如蛏子捞饭开头那一组步骤）放到最前面
  const stray = preamble.trim();
  if (stray) stepBlocks.unshift(...wrapSteps(stray));

  const main = [processTitle ? `<h2>${processTitle}</h2>` : '', ...stepBlocks, extras]
    .filter(Boolean)
    .join('\n')
    .trim();

  return {
    ok: side.length > 0 && stepBlocks.length > 0,
    side,
    sideSections,
    schedule,
    processTitle,
    steps: stepBlocks,
    extras,
    tips: tips.length ? tips.join('\n') : null,
    main,
  };
}

/** 用 Astro 自己的 Markdown 渲染管线把内容组件转成 HTML，再拆栏 */
export async function splitRecipeContent(Content: AstroComponentFactory): Promise<RecipeParts> {
  // 每次新建容器，避免构建并发时互相干扰
  const container = await AstroContainer.create();
  const html = await container.renderToString(Content);
  return splitRecipeHtml(html);
}
