#!/usr/bin/env node
/**
 * 把 Obsidian 菜谱库同步成站点的内容与图片资源。
 *
 * 源目录（可用环境变量覆盖）：
 *   RECIPE_VAULT   默认 C:/Users/32347/OneDrive/文档/obsidian/菜单/菜谱库
 *   RECIPE_IMAGES  默认 C:/Users/32347/OneDrive/文档/obsidian/菜单/图片
 *
 * 产物（需要提交到仓库，CI 构建时不再依赖 Obsidian）：
 *   src/content/recipes/<slug>.md   规范化后的 Markdown
 *   src/assets/recipes/<slug>.webp  压缩后的封面图
 *   recipes-src/<分类>/<菜名>.md     原文镜像（版本历史用）
 *   .cache/sync-state.json          源目录指纹（判断线上内容是否过期）
 *
 * 校验不通过会直接失败，不会静默降级。
 *
 * 用法：npm run sync
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import GithubSlugger from 'github-slugger';
import sharp from 'sharp';
import YAML from 'yaml';
import { buildFonts } from './build-fonts.mjs';
import { VAULT_DIR, IMAGE_DIR, STATE_FILE, fingerprint } from './lib/vault-state.mjs';

const CONTENT_DIR = 'src/content/recipes';
const ASSET_DIR = 'src/assets/recipes';
const SOURCE_MIRROR_DIR = 'recipes-src';

/** 首页分类的展示顺序 */
const CATEGORY_ORDER = ['蛋白质', '蔬菜', '主食'];
/** 会占用站点根路径的名字，避免菜名撞车 */
const RESERVED_SLUGS = new Set(['index', '404', 'about', 'recipes', 'assets', '_astro']);
/** 菜谱库根目录下不是分类的目录 */
const IGNORED_DIRS = new Set(['模板', '.obsidian', '图片']);

const MAX_WIDTH = 1600;
const WEBP_QUALITY = 82;
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|svg|avif|bmp|tiff?)$/i;

const errors = [];
const warnings = [];

function fail(message) {
	console.error(`\n✖ ${message}\n`);
	process.exit(1);
}

/** 拆分 `---` frontmatter，解析失败时当作没有 frontmatter */
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

/** 统一标题文本：去掉加粗标记、首尾空白 */
function cleanHeadingText(raw) {
	return raw
		.replace(/^\*\*(.*)\*\*$/, '$1')
		.replace(/\*\*/g, '')
		.trim();
}

function sanitizeSlug(title) {
	const slug = title
		.trim()
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');

	return RESERVED_SLUGS.has(slug.toLowerCase()) ? `dish-${slug}` : slug || 'recipe';
}

function normalizeTags(raw) {
	const tags = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
	return [...new Set(tags.map((tag) => String(tag).trim()).filter((tag) => tag && tag !== 'receipt'))];
}

/** category 可以是字符串，也可以是数组（第一个当主分类） */
function normalizeCategories(raw, fallback) {
	const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
	const clean = [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
	if (clean.length) return clean;
	return fallback ? [fallback] : [];
}

/** 从「步骤 / 时间」表里累加总时长（分钟） */
function totalMinutes(body) {
	let total = 0;
	let found = false;

	for (const line of body.split(/\r?\n/)) {
		if (!line.trim().startsWith('|')) continue;
		const cells = line.split('|').map((cell) => cell.trim());
		if (cells.length < 3) continue;
		const value = cells[cells.length - 2];
		const match = value.match(/^(\d+(?:\.\d+)?)\s*(min|分钟|小时|h|hour)/i);
		if (!match) continue;
		const amount = Number(match[1]);
		const unit = match[2].toLowerCase();
		total += unit === '小时' || unit === 'h' || unit === 'hour' ? amount * 60 : amount;
		found = true;
	}

	return found ? Math.round(total) : undefined;
}

/**
 * 把 Obsidian Markdown 转成普通 Markdown（保留对历史写法的兼容）。
 * - 删除 %% 注释 %% 与图片嵌入
 * - 标题层级统一从 h2 开始
 * - [[#标题]] → 页内锚点，断链降级为纯文本
 */
function transformBody(rawBody) {
	let body = rawBody.replace(/%%[\s\S]*?%%/g, '');

	body = body.replace(
		/!?\[\[[^\]\n]*?\.(?:png|jpe?g|webp|gif|svg|avif|bmp|tiff?)(?:\|[^\]\n]*)?\]\]/gi,
		'',
	);

	const headingPattern = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
	const headings = [...body.matchAll(headingPattern)].map((match) => ({
		level: match[1].length,
		text: cleanHeadingText(match[2]),
	}));

	const levels = [...new Set(headings.map((heading) => heading.level))].sort((a, b) => a - b);
	const levelMap = new Map(levels.map((level, index) => [level, Math.min(2 + index, 6)]));

	const slugger = new GithubSlugger();
	const anchors = new Map(headings.map((heading) => [heading.text, slugger.slug(heading.text)]));

	body = body.replace(headingPattern, (_, hashes, text) => {
		const clean = cleanHeadingText(text);
		const level = levelMap.get(hashes.length) ?? 2;
		return `${'#'.repeat(level)} ${clean}`;
	});

	body = body.replace(/\[\[([^\]\n]+?)\]\]/g, (_, inner) => {
		const [targetRaw, aliasRaw] = inner.split('|');
		const target = targetRaw.trim();
		const heading = target.replace(/^#/, '').trim();
		const label = (aliasRaw ?? heading).trim();
		const anchor = anchors.get(heading);

		if (anchor) return `[${label}](#${anchor})`;
		return label;
	});

	return body.replace(/\n{3,}/g, '\n\n').trim();
}

async function buildImageIndex() {
	const files = await readdir(IMAGE_DIR, { withFileTypes: true });
	const index = new Map();
	for (const file of files) {
		if (file.isFile() && IMAGE_EXT.test(file.name)) index.set(file.name.toLowerCase(), file.name);
	}
	return index;
}

function resolveCoverFile(data, title, imageIndex) {
	const rawCover = data.cover;
	const fromFrontmatter =
		typeof rawCover === 'string' ? (rawCover.match(/\[\[([^\]|]+)/)?.[1] ?? rawCover).trim() : null;

	const candidates = [fromFrontmatter, `${title}.png`, `${title}.jpg`, `${title}.jpeg`, `${title}.webp`];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const hit = imageIndex.get(path.basename(candidate).toLowerCase());
		if (hit) return hit;
	}
	return null;
}

async function collectRecipes(imageIndex) {
	const entries = [];
	const skipped = [];
	const categories = (await readdir(VAULT_DIR, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
		.map((entry) => entry.name);

	for (const folder of categories) {
		const files = (await readdir(path.join(VAULT_DIR, folder), { withFileTypes: true }))
			.filter((file) => file.isFile() && file.name.toLowerCase().endsWith('.md'))
			.map((file) => file.name);

		for (const fileName of files) {
			const title = fileName.replace(/\.md$/i, '').trim();
			const raw = await readFile(path.join(VAULT_DIR, folder, fileName), 'utf8');

			if (!raw.trim()) {
				skipped.push(`${folder}/${title}（空文件）`);
				continue;
			}

			const { data, body } = splitFrontmatter(raw);
			const content = transformBody(body);

			// ---- 结构校验：有问题立刻报错，不静默降级 ----
			if (!/^## 食材[ \t]*$/m.test(content)) errors.push(`${folder}/${title}：缺少「## 食材」段落`);
			if (!/^## 制作[ \t]*$/m.test(content)) {
				// 没有制作段：不阻断同步，但必须在日志里报出来（页面会回退成单栏）
				warnings.push(`${folder}/${title}：没有「## 制作」段落，页面上会退化成单栏`);
			} else {
				const processBlock = content.split(/^## 制作\s*$/m)[1]?.split(/^## /m)[0] ?? '';
				if (!/^### /m.test(processBlock)) errors.push(`${folder}/${title}：「## 制作」下面没有 ### 步骤`);
			}
			if (!content.trim()) errors.push(`${folder}/${title}：正文为空`);

			const categoriesForRecipe = normalizeCategories(data.category, folder);
			entries.push({
				title,
				folder,
				primaryCategory: categoriesForRecipe[0] ?? folder,
				categories: categoriesForRecipe,
				order: 0,
				tags: normalizeTags(data.tags),
				slug: sanitizeSlug(title),
				coverFile: resolveCoverFile(data, title, imageIndex),
				minutes: totalMinutes(content),
				body: content,
				raw,
			});
		}
	}

	entries.sort((a, b) => {
		const ai = CATEGORY_ORDER.indexOf(a.primaryCategory);
		const bi = CATEGORY_ORDER.indexOf(b.primaryCategory);
		if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
		return a.title.localeCompare(b.title, 'zh-Hans-CN');
	});

	const counter = new Map();
	for (const entry of entries) {
		const next = (counter.get(entry.primaryCategory) ?? 0) + 1;
		counter.set(entry.primaryCategory, next);
		entry.order = next;
	}

	return { entries, skipped };
}

function renderMarkdownFile(entry, coverPath) {
	const lines = [
		'---',
		`title: ${JSON.stringify(entry.title)}`,
		`category: ${JSON.stringify(entry.primaryCategory)}`,
		`categories: ${JSON.stringify(entry.categories)}`,
		`order: ${entry.order}`,
	];
	if (entry.minutes) lines.push(`time: ${entry.minutes}`);
	if (entry.tags.length) {
		lines.push('tags:');
		for (const tag of entry.tags) lines.push(`  - ${JSON.stringify(tag)}`);
	}
	if (coverPath) lines.push(`cover: ${JSON.stringify(coverPath)}`);
	lines.push('---', '', entry.body, '');

	return lines.join('\n');
}

async function writeCover(entry) {
	if (!entry.coverFile) return { originalBytes: 0, webpBytes: 0 };

	const srcFile = path.join(IMAGE_DIR, entry.coverFile);
	const destFile = path.join(ASSET_DIR, `${entry.slug}.webp`);

	const before = await stat(srcFile);
	const after = await sharp(srcFile)
		.rotate()
		.resize({ width: MAX_WIDTH, height: MAX_WIDTH, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: WEBP_QUALITY, effort: 4 })
		.toFile(destFile);

	return { originalBytes: before.size, webpBytes: after.size };
}

/** 网页新增的菜谱（source: web）在同步时保留 */
async function collectWebEntries() {
	if (!existsSync(CONTENT_DIR)) return [];
	const files = (await readdir(CONTENT_DIR)).filter((file) => file.endsWith('.md'));
	const kept = [];

	for (const file of files) {
		const raw = await readFile(path.join(CONTENT_DIR, file), 'utf8');
		if (/^source:\s*["']?web["']?$/m.test(raw)) kept.push({ file, raw });
	}
	return kept;
}

async function main() {
	if (!existsSync(VAULT_DIR)) fail(`找不到菜谱目录：${VAULT_DIR}\n  可以用 RECIPE_VAULT 环境变量指定其他路径。`);
	if (!existsSync(IMAGE_DIR)) fail(`找不到图片目录：${IMAGE_DIR}\n  可以用 RECIPE_IMAGES 环境变量指定其他路径。`);

	const imageIndex = await buildImageIndex();
	const { entries, skipped } = await collectRecipes(imageIndex);

	const seen = new Map();
	for (const entry of entries) {
		if (seen.has(entry.slug)) errors.push(`菜名重复：${entry.title}（${seen.get(entry.slug)} 与 ${entry.folder}）`);
		seen.set(entry.slug, entry.folder);
		if (!entry.coverFile) warnings.push(`${entry.folder}/${entry.title}：没有封面图`);
	}

	if (errors.length) {
		console.error('\n✖ 内容校验没通过：');
		for (const message of errors) console.error(`  · ${message}`);
		console.error('\n先修好这些再同步（写法见 README 的「菜谱写法」）。\n');
		process.exit(1);
	}

	const webEntries = await collectWebEntries();
	await rm(CONTENT_DIR, { recursive: true, force: true });
	await rm(ASSET_DIR, { recursive: true, force: true });
	await rm(SOURCE_MIRROR_DIR, { recursive: true, force: true });
	await mkdir(CONTENT_DIR, { recursive: true });
	await mkdir(ASSET_DIR, { recursive: true });

	let originalBytes = 0;
	let webpBytes = 0;

	for (const entry of entries) {
		const sizes = await writeCover(entry);
		originalBytes += sizes.originalBytes;
		webpBytes += sizes.webpBytes;

		const coverPath = entry.coverFile ? `${entry.slug}.webp` : null;
		await writeFile(path.join(CONTENT_DIR, `${entry.slug}.md`), renderMarkdownFile(entry, coverPath), 'utf8');

		// 原文镜像：只镜像 md（几 KB），图片仍留在 Obsidian 里
		const mirrorDir = path.join(SOURCE_MIRROR_DIR, entry.folder);
		await mkdir(mirrorDir, { recursive: true });
		await writeFile(path.join(mirrorDir, `${entry.title}.md`), entry.raw, 'utf8');
	}

	for (const kept of webEntries) {
		await writeFile(path.join(CONTENT_DIR, kept.file), kept.raw, 'utf8');
	}

	const fontsChanged = await buildFonts({ quiet: true });
	const state = await fingerprint([VAULT_DIR, IMAGE_DIR]);
	await mkdir(path.dirname(STATE_FILE), { recursive: true });
	await writeFile(
		STATE_FILE,
		JSON.stringify({ ...state, syncedAt: new Date().toISOString(), recipes: entries.length }, null, 2),
		'utf8',
	);

	const byCategory = CATEGORY_ORDER.map(
		(category) => `${category} ${entries.filter((entry) => entry.primaryCategory === category).length}`,
	).join(' · ');

	console.log('\n────────────────────────────');
	console.log(`菜谱 ${entries.length} 道：${byCategory}`);
	if (webEntries.length) console.log(`保留网页新增 ${webEntries.length} 篇`);
	if (skipped.length) console.log(`跳过：${skipped.join('、')}`);
	if (warnings.length) {
		console.log(`提醒 ${warnings.length} 条：`);
		for (const message of warnings) console.log(`  · ${message}`);
	}
	if (originalBytes) {
		const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
		console.log(`封面图 ${mb(originalBytes)} → ${mb(webpBytes)}`);
	}
	console.log(fontsChanged ? '字体子集已重建' : '字体子集无需更新');
	console.log('────────────────────────────\n');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
