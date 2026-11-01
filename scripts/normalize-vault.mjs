#!/usr/bin/env node
/**
 * 一次性把 Obsidian 菜谱库的段落写法统一成受控词表。
 *
 * 默认 dry-run，只打印会改什么；加 --apply 才真正写回（会先备份）。
 *
 *   node scripts/normalize-vault.mjs
 *   node scripts/normalize-vault.mjs --apply
 *
 * 规范化内容：
 *   - 段落名：食材清单 / 购物清单 / 材料 → `## 食材`
 *             制作流程 / 做法 / 步骤   → `## 制作`
 *             小贴士 / 提示           → `## TIPS`
 *   - 层级：段落一律 H2，步骤与食材分组一律 H3，正文不出现 H1
 *   - frontmatter：补 category，清掉 receipt 标签，其余原样保留
 */
import { cp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const VAULT_DIR = process.env.RECIPE_VAULT || 'C:/Users/32347/OneDrive/文档/obsidian/菜单/菜谱库';
const BACKUP_DIR = '.cache/vault-backup';
const APPLY = process.argv.includes('--apply');

const CATEGORY_ORDER = ['蛋白质', '蔬菜', '主食'];

const INGREDIENTS = /^(食材清单|购物清单|食材|材料|原料|配料|用料)$/;
const PROCESS = /^(制作流程|制作过程|制作|做法|步骤|烹饪|操作)$/;
const TIPS = /^(tips|小贴士|提示|注意事项|贴士)$/i;
const GENERIC_INGREDIENTS = /^(食材|食材清单|购物清单)$/;
const GENERIC_PROCESS = /^(制作|制作流程|制作过程|步骤|做法)$/;

/** “食材清单（自制盐曲…）” 这种带括号的，去掉括号内容再判断 */
function headingKey(text) {
  return text
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

function splitFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!match) return { data: {}, body: text };
  let data = {};
  try {
    const parsed = YAML.parse(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch {
    data = {};
  }
  return { data, body: text.slice(match[0].length) };
}

function normalizeBody(body) {
  const lines = body.split(/\r?\n/);
  const out = [];
  let mode = 'none';
  let created = { ingredients: false, process: false, tips: false };
  const changes = [];

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (!heading) {
      out.push(line);
      continue;
    }

    const level = heading[1].length;
    const raw = heading[2].trim();
    const key = headingKey(raw);

    if (TIPS.test(key)) {
      if (!created.tips) {
        changes.push(`${'#'.repeat(level)} ${raw} → ## TIPS`);
        out.push('## TIPS');
        created.tips = true;
      } else {
        changes.push(`（删除重复的 TIPS 标题）${raw}`);
      }
      mode = 'tips';
      continue;
    }

    if (INGREDIENTS.test(key)) {
      if (mode !== 'ingredients' || !created.ingredients) {
        changes.push(`${'#'.repeat(level)} ${raw} → ## 食材`);
        out.push('## 食材');
        created.ingredients = true;
        mode = 'ingredients';
        continue;
      }
      if (GENERIC_INGREDIENTS.test(key)) {
        changes.push(`（删除嵌套的食材标题）${raw}`);
        continue;
      }
      changes.push(`${'#'.repeat(level)} ${raw} → ### ${raw}`);
      out.push(`### ${raw}`);
      mode = 'ingredients';
      continue;
    }

    if (PROCESS.test(key)) {
      if (mode !== 'process' || !created.process) {
        changes.push(`${'#'.repeat(level)} ${raw} → ## 制作`);
        out.push('## 制作');
        created.process = true;
        mode = 'process';
        continue;
      }
      if (GENERIC_PROCESS.test(key)) {
        changes.push(`（删除嵌套的制作标题）${raw}`);
        continue;
      }
      changes.push(`${'#'.repeat(level)} ${raw} → ### ${raw}`);
      out.push(`### ${raw}`);
      mode = 'process';
      continue;
    }

    // 其余标题：制作段里当步骤，食材段里当分组，开头零散内容当步骤
    if (mode === 'none') {
      changes.push(`（补上「## 制作」）${raw}`);
      out.push('## 制作');
      created.process = true;
      mode = 'process';
    }
    changes.push(`${'#'.repeat(level)} ${raw} → ### ${raw}`);
    out.push(`### ${raw}`);
  }

  let result = out.join('\n');

  // 完全没有小标题的文件（比如煎饼）：整篇当成食材清单
  if (!created.ingredients && !created.process && !created.tips) {
    result = `## 食材\n\n${result.trim()}`;
    changes.push('（整篇没有标题，归到「## 食材」）');
  }

  return { body: result.replace(/\n{3,}/g, '\n\n').trim(), changes };
}

function renderFrontmatter(data) {
  const lines = ['---'];
  if (data.cover) lines.push(`cover: ${JSON.stringify(data.cover)}`);
  if (data.category) lines.push(`category: ${JSON.stringify(data.category)}`);
  const tags = Array.isArray(data.tags) ? data.tags : [];
  if (tags.length) {
    lines.push('tags:');
    for (const tag of tags) lines.push(`  - ${JSON.stringify(tag)}`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (['cover', 'category', 'tags'].includes(key)) continue;
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

async function main() {
  const stats = await stat(VAULT_DIR).catch(() => null);
  if (!stats?.isDirectory()) {
    console.error(`✖ 找不到菜谱目录：${VAULT_DIR}`);
    process.exit(1);
  }

  if (APPLY) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(BACKUP_DIR, stamp);
    await cp(VAULT_DIR, target, { recursive: true });
    console.log(`已备份到 ${target}\n`);
  }

  const categories = (await readdir(VAULT_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && CATEGORY_ORDER.includes(entry.name))
    .map((entry) => entry.name);

  let changed = 0;
  let untouched = 0;
  const skipped = [];

  for (const category of categories) {
    const dir = path.join(VAULT_DIR, category);
    const files = (await readdir(dir, { withFileTypes: true }))
      .filter((file) => file.isFile() && file.name.endsWith('.md'))
      .map((file) => file.name);

    for (const file of files) {
      const full = path.join(dir, file);
      const raw = await readFile(full, 'utf8');

      if (!raw.trim()) {
        skipped.push(`${category}/${file}（空文件）`);
        continue;
      }

      const { data, body } = splitFrontmatter(raw);
      const normalized = normalizeBody(body);

      const nextData = { ...data };
      if (!nextData.category) nextData.category = category;
      if (Array.isArray(nextData.tags)) {
        nextData.tags = nextData.tags.filter((tag) => tag !== 'receipt');
      }

      const next = renderFrontmatter(nextData) + normalized.body + '\n';
      const frontmatterChanged = JSON.stringify(nextData) !== JSON.stringify(data);

      if (next === raw) {
        untouched += 1;
        continue;
      }

      changed += 1;
      console.log(`\n● ${category}/${file}`);
      for (const change of normalized.changes.slice(0, 8)) console.log(`   ${change}`);
      if (normalized.changes.length > 8) console.log(`   …还有 ${normalized.changes.length - 8} 处`);
      if (frontmatterChanged) console.log(`   frontmatter: ${Object.keys(data).join(',') || '无'} → ${Object.keys(nextData).join(',')}`);

      if (APPLY) await writeFile(full, next, 'utf8');
    }
  }

  console.log(`\n──────────────`);
  console.log(`${APPLY ? '已修改' : '将修改'} ${changed} 篇，未变 ${untouched} 篇`);
  if (skipped.length) console.log(`跳过：${skipped.join('、')}`);
  if (!APPLY && changed) console.log('\n确认无误后加 --apply 真正写入（会先备份）。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
