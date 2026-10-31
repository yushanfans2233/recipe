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
 *
 * 用法：npm run sync
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import sharp from 'sharp';
import YAML from 'yaml';

const VAULT_DIR = process.env.RECIPE_VAULT || 'C:/Users/32347/OneDrive/文档/obsidian/菜单/菜谱库';
const IMAGE_DIR = process.env.RECIPE_IMAGES || 'C:/Users/32347/OneDrive/文档/obsidian/菜单/图片';

const CONTENT_DIR = 'src/content/recipes';
const ASSET_DIR = 'src/assets/recipes';

/** 首页分类的展示顺序 */
const CATEGORY_ORDER = ['蛋白质', '蔬菜', '主食'];
/** 会占用站点根路径的名字，避免菜名撞车 */
const RESERVED_SLUGS = new Set(['index', '404', 'about', 'recipes', 'assets', '_astro']);
/** 菜谱库根目录下不是分类的目录 */
const IGNORED_DIRS = new Set(['模板', '.obsidian', '图片']);

const MAX_WIDTH = 1600;
const WEBP_QUALITY = 82;
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|svg|avif|bmp|tiff?)$/i;

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

/**
 * 把 Obsidian Markdown 转成普通 Markdown：
 * - 删除 %% 注释 %%
 * - 删除 ![[图片]] / [[图片]] 嵌入（封面单独渲染）
 * - 标题层级重排（源文件里 # / ## / ### 混用，统一成从 h2 开始）
 * - [[#标题]] → [标题](#slug)，断链降级成纯文本
 */
function transformBody(rawBody) {
	let body = rawBody.replace(/%%[\s\S]*?%%/g, '');

	// 图片嵌入与图片双链：封面单独渲染，正文里去掉
	body = body.replace(
		/!?\[\[[^\]\n]*?\.(?:png|jpe?g|webp|gif|svg|avif|bmp|tiff?)(?:\|[^\]\n]*)?\]\]/gi,
		'',
	);

	// 先按文档顺序给所有标题生成锚点，保证和渲染器一致
	const headingPattern = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
	const headings = [...body.matchAll(headingPattern)].map((match) => ({
		level: match[1].length,
		text: cleanHeadingText(match[2]),
	}));

	const levels = [...new Set(headings.map((heading) => heading.level))].sort((a, b) => a - b);
	// 最浅的一级标题映射到 h2（页面标题已占用 h1）
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
		// 链接文字默认用标题本身，不要带 # 前缀
		const label = (aliasRaw ?? heading).trim();
		const anchor = anchors.get(heading);

		// 指向文档内的标题（或指向本文件中存在的标题）
		if (anchor) return `[${label}](#${anchor})`;
		// 指向没有收录的笔记（如 [[面粉小知识]]），只保留文字
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

	const categoryNames = (await readdir(VAULT_DIR, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
		.map((entry) => entry.name);

	for (const category of categoryNames) {
		const fileNames = (await readdir(path.join(VAULT_DIR, category), { withFileTypes: true }))
			.filter((file) => file.isFile() && file.name.toLowerCase().endsWith('.md'))
			.map((file) => file.name);

		for (const fileName of fileNames) {
			const title = fileName.replace(/\.md$/i, '').trim();
			const raw = await readFile(path.join(VAULT_DIR, category, fileName), 'utf8');

			if (!raw.trim()) {
				skipped.push({ title, category, reason: '空文件' });
				continue;
			}

			const { data, body } = splitFrontmatter(raw);
			const content = transformBody(body);

			if (!content.trim()) {
				skipped.push({ title, category, reason: '正文为空' });
				continue;
			}

			entries.push({
				title,
				category,
				order: 0,
				tags: normalizeTags(data.tags),
				slug: sanitizeSlug(title),
				coverFile: resolveCoverFile(data, title, imageIndex),
				body: content,
			});
		}
	}

	// 稳定排序：分类顺序 → 菜名（中文按拼音）
	entries.sort((a, b) => {
		const ai = CATEGORY_ORDER.indexOf(a.category);
		const bi = CATEGORY_ORDER.indexOf(b.category);
		if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
		return a.title.localeCompare(b.title, 'zh-Hans-CN');
	});

	const counter = new Map();
	for (const entry of entries) {
		const next = (counter.get(entry.category) ?? 0) + 1;
		counter.set(entry.category, next);
		entry.order = next;
	}

	return { entries, skipped };
}

function renderMarkdownFile(entry, coverPath) {
	const lines = [
		'---',
		`title: ${JSON.stringify(entry.title)}`,
		`category: ${JSON.stringify(entry.category)}`,
		`order: ${entry.order}`,
	];
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

async function main() {
	if (!existsSync(VAULT_DIR)) {
		fail(`找不到菜谱目录：${VAULT_DIR}\n  可以用 RECIPE_VAULT 环境变量指定其他路径。`);
	}
	if (!existsSync(IMAGE_DIR)) {
		fail(`找不到图片目录：${IMAGE_DIR}\n  可以用 RECIPE_IMAGES 环境变量指定其他路径。`);
	}

	const imageIndex = await buildImageIndex();
	const { entries, skipped } = await collectRecipes(imageIndex);

	// 防止同名菜谱生成同一个页面
	const seen = new Map();
	for (const entry of entries) {
		if (seen.has(entry.slug)) fail(`菜名重复：${entry.title}（${seen.get(entry.slug)} 与 ${entry.category}），请先改名。`);
		seen.set(entry.slug, entry.category);
	}

	await rm(CONTENT_DIR, { recursive: true, force: true });
	await rm(ASSET_DIR, { recursive: true, force: true });
	await mkdir(CONTENT_DIR, { recursive: true });
	await mkdir(ASSET_DIR, { recursive: true });

	let originalBytes = 0;
	let webpBytes = 0;
	const missingCovers = [];

	for (const entry of entries) {
		const sizes = await writeCover(entry);
		originalBytes += sizes.originalBytes;
		webpBytes += sizes.webpBytes;
		if (!entry.coverFile) missingCovers.push(`${entry.category}/${entry.title}`);

		const coverPath = entry.coverFile ? `${entry.slug}.webp` : null;
		await writeFile(path.join(CONTENT_DIR, `${entry.slug}.md`), renderMarkdownFile(entry, coverPath), 'utf8');

		console.log(`  ${entry.category}  ${entry.title}  →  ${entry.slug}.md${coverPath ? '' : '  （无封面）'}`);
	}

	const byCategory = CATEGORY_ORDER.map(
		(category) => `${category} ${entries.filter((entry) => entry.category === category).length}`,
	).join(' · ');

	console.log('\n────────────────────────────');
	console.log(`菜谱 ${entries.length} 道：${byCategory}`);
	if (missingCovers.length) console.log(`无封面 ${missingCovers.length} 道：${missingCovers.join('、')}`);
	if (skipped.length) {
		console.log(
			`跳过 ${skipped.length} 个文件：${skipped.map((item) => `${item.category}/${item.title}（${item.reason}）`).join('、')}`,
		);
	}
	if (originalBytes) {
		const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
		console.log(`封面图 ${mb(originalBytes)} → ${mb(webpBytes)}（WebP 最长边 ${MAX_WIDTH}px）`);
	}
	console.log('────────────────────────────\n');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
