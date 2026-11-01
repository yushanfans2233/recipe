/**
 * 从规范化后的菜谱 Markdown 里取出食材与步骤，供搜索索引和结构化数据使用。
 * 约定见 README：`## 食材` + `## 制作`（步骤用 `###`）。
 */
export interface ParsedStep {
  name: string;
  items: string[];
}

export interface ParsedRecipe {
  ingredients: string[];
  seasoning: string[];
  steps: ParsedStep[];
}

function cleanInline(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*]\s*\[[ x]\]\s*/i, '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/^\s*[-*]\s*/, '')
    .trim();
}

function sectionOf(body: string, title: string): string {
  // 不用正则取段落：惰性量词配 `$` 前瞻会立刻命中，只能拿到空串
  const chunks = body.split(/^## /m);
  for (let index = 1; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const breakAt = chunk.indexOf('\n');
    const heading = (breakAt === -1 ? chunk : chunk.slice(0, breakAt)).trim();
    if (heading === title) return breakAt === -1 ? '' : chunk.slice(breakAt + 1);
  }
  return '';
}

function parseIngredients(section: string, into: string[]) {
  let group = 'main';

  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('### ')) {
      const name = cleanInline(line.slice(4));
      group = /调味|料汁|酱汁|小料|蘸料|焯水/.test(name) ? 'seasoning' : 'main';
      continue;
    }

    // 表格行：| 食材 | 数量 |
    if (line.startsWith('|')) {
      const cells = line.split('|').map((cell) => cleanInline(cell));
      if (cells.length < 3) continue;
      const name = cells[1];
      if (!name || /^-+$/.test(name) || name === '食材' || name === '名称') continue;
      const amount = cells[2] ?? '';
      into.push(amount ? `${name} ${amount}` : name);
      continue;
    }

    // 列表行
    const item = cleanInline(line);
    if (item) into.push(item);
  }
}

/** 解析出食材、调味、步骤 */
export function parseRecipeMarkdown(body: string): ParsedRecipe {
  const ingredientSection = sectionOf(body, '食材');
  const processSection = sectionOf(body, '制作');

  const main: string[] = [];
  const seasoning: string[] = [];
  parseIngredients(ingredientSection, main);

  // 调味分组单独收集
  const seasoningBlock = ingredientSection.match(/^###\s*(?:调味|料汁|酱汁|小料|蘸料)[^\n]*\n([\s\S]*?)(?=^### |^## |$)/m);
  if (seasoningBlock) {
    parseIngredients(seasoningBlock[1], seasoning);
  }

  const steps: ParsedStep[] = [];
  let current: ParsedStep | null = null;

  for (const rawLine of processSection.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('### ')) {
      current = { name: cleanInline(line.slice(4)), items: [] };
      steps.push(current);
      continue;
    }

    if (line.startsWith('|')) continue; // 步骤/时间表不进步骤正文

    const item = cleanInline(line);
    if (!item) continue;
    if (!current) {
      current = { name: '制作', items: [] };
      steps.push(current);
    }
    current.items.push(item);
  }

  // 调味如果被算进了主食材，去重
  const seasoningSet = new Set(seasoning);
  const mainOnly = main.filter((item) => !seasoningSet.has(item));

  return { ingredients: mainOnly, seasoning, steps };
}
