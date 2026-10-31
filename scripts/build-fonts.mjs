#!/usr/bin/env node
/**
 * 把源字体按站点实际用字做子集化，输出到 src/assets/fonts/。
 *
 * 中文手写字体动辄 20MB+，直接引入不可接受；这里只保留页面里出现过的字，
 * 生成 200~500KB 的 woff2。新增菜谱后如果出现缺字（会回退到系统字体），
 * 重新跑一次 `npm run fonts` 即可。
 *
 * 源字体（首次运行会下载到 .cache/fonts/，不进仓库）：
 *   LXGW WenKai   正文字体，SIL OFL 1.1
 *   ZCOOL KuaiLe  标题字体，SIL OFL 1.1
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import subsetFont from 'subset-font';

const CACHE_DIR = '.cache/fonts';
const OUT_DIR = 'src/assets/fonts';

/** 扫描这些目录/文件里的文字，决定子集范围 */
const TEXT_SOURCES = [
	'src/content',
	'src/pages',
	'src/layouts',
	'src/lib',
	'src/utils',
	'src/styles',
	'astro.config.mjs',
];

const FONTS = [
	{
		id: 'hand',
		family: 'Sketch Working Hand',
		file: 'LXGWWenKai-Regular.ttf',
		url: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Regular.ttf',
		output: 'hand-regular.woff2',
	},
	{
		id: 'marker',
		family: 'Sketch Working Marker',
		file: 'ZCOOLKuaiLe-Regular.ttf',
		url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf',
		output: 'marker-regular.woff2',
	},
];

/** 始终保留的基础字符：ASCII、数字、常用中英标点 */
const BASE_CHARS = (() => {
	const ascii = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('');
	const extra =
		'，。、；：！？…—～·「」『』（）《》〈〉【】“”‘’％℃±×÷≈≤≥°′″　';
	return ascii + extra;
})();

async function collectText(dir) {
	const stats = await stat(dir).catch(() => null);
	if (!stats) return '';

	if (stats.isFile()) {
		if (!/\.(astro|md|ts|mjs|css|json)$/.test(dir)) return '';
		return readFile(dir, 'utf8');
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const chunks = await Promise.all(entries.map((entry) => collectText(path.join(dir, entry.name))));
	return chunks.join('');
}

async function collectCharacters() {
	const text = (await Promise.all(TEXT_SOURCES.map((source) => collectText(source)))).join('');
	const chars = new Set(BASE_CHARS);

	for (const char of text) {
		const code = char.codePointAt(0);
		// 跳过控制字符
		if (code === undefined || code < 0x20) continue;
		chars.add(char);
	}
	return [...chars].join('');
}

async function ensureSource(font) {
	const target = path.join(CACHE_DIR, font.file);
	if (existsSync(target)) return target;

	console.log(`  下载 ${font.file} …`);
	const response = await fetch(font.url, { redirect: 'follow' });
	if (!response.ok) throw new Error(`下载失败 ${font.url}: ${response.status}`);

	await mkdir(CACHE_DIR, { recursive: true });
	await writeFile(target, Buffer.from(await response.arrayBuffer()));
	return target;
}

async function main() {
	const characters = await collectCharacters();
	const uniqueCount = [...characters].length;

	await mkdir(OUT_DIR, { recursive: true });
	console.log(`\n子集字符数：${uniqueCount}`);

	for (const font of FONTS) {
		const sourcePath = await ensureSource(font);
		const source = await readFile(sourcePath);
		const subset = await subsetFont(source, characters, { targetFormat: 'woff2' });

		const outPath = path.join(OUT_DIR, font.output);
		await writeFile(outPath, subset);

		const before = (await stat(sourcePath)).size;
		const after = subset.length;
		const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
		const kb = (bytes) => `${Math.round(bytes / 1024)}KB`;
		console.log(
			`  ${font.family.padEnd(22)} ${mb(before)} → ${kb(after)}  ${path.relative(process.cwd(), outPath)}`,
		);
	}

	console.log('\n字体已更新。\n');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
