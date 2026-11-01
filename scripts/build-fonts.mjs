#!/usr/bin/env node
/**
 * 把源字体按站点实际用字做子集化，输出到 src/assets/fonts/。
 *
 * 可以命令行直接跑（npm run fonts），也可以被同步脚本 import 调用：
 *   const changed = await buildFonts({ quiet: true });
 *
 * 同时把用到的字符集写到 src/assets/fonts/subset-chars.json，
 * 供 scripts/check-fonts.mjs 检查「内容出现新字但字体没重建」。
 *
 * 源字体（首次运行会下载到 .cache/fonts/，不进仓库）：
 *   LXGW WenKai   正文字体，SIL OFL 1.1
 *   ZCOOL KuaiLe  标题字体，SIL OFL 1.1
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import subsetFont from 'subset-font';

const CACHE_DIR = '.cache/fonts';
const OUT_DIR = 'src/assets/fonts';
const CHARS_FILE = path.join(OUT_DIR, 'subset-chars.json');

const TEXT_SOURCES = [
	'src/content',
	'src/pages',
	'src/layouts',
	'src/components',
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

const BASE_CHARS = (() => {
	const ascii = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('');
	const extra = '，。、；：！？…—～·「」『』（）《》〈〉【】“”‘’％℃±×÷≈≤≥°′″　';
	return ascii + extra;
})();

async function collectText(target) {
	const stats = await stat(target).catch(() => null);
	if (!stats) return '';

	if (stats.isFile()) {
		if (!/\.(astro|md|ts|mjs|css|json)$/.test(target)) return '';
		return readFile(target, 'utf8');
	}

	const entries = await readdir(target, { withFileTypes: true });
	const chunks = await Promise.all(entries.map((entry) => collectText(path.join(target, entry.name))));
	return chunks.join('');
}

export async function collectCharacters() {
	const text = (await Promise.all(TEXT_SOURCES.map((source) => collectText(source)))).join('');
	const chars = new Set(BASE_CHARS);

	for (const char of text) {
		const code = char.codePointAt(0);
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

async function readCharsState() {
	const raw = await readFile(CHARS_FILE, 'utf8').catch(() => null);
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/**
 * 重建字体子集。
 * @param {{ quiet?: boolean, force?: boolean }} options
 * @returns {Promise<boolean>} 是否真的重建了
 */
export async function buildFonts({ quiet = false, force = false } = {}) {
	const characters = await collectCharacters();
	const hash = createHash('sha1').update(characters).digest('hex').slice(0, 12);
	const previous = await readCharsState();

	if (!force && previous?.hash === hash && existsSync(path.join(OUT_DIR, FONTS[0].output))) {
		if (!quiet) console.log(`字体子集已是最新（${[...characters].length} 字）`);
		return false;
	}

	await mkdir(OUT_DIR, { recursive: true });
	if (!quiet) console.log(`\n子集字符数：${[...characters].length}`);

	for (const font of FONTS) {
		const sourcePath = await ensureSource(font);
		const source = await readFile(sourcePath);
		const subset = await subsetFont(source, characters, { targetFormat: 'woff2' });

		const outPath = path.join(OUT_DIR, font.output);
		await writeFile(outPath, subset);

		if (!quiet) {
			const before = (await stat(sourcePath)).size;
			const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
			const kb = (bytes) => `${Math.round(bytes / 1024)}KB`;
			console.log(
				`  ${font.family.padEnd(22)} ${mb(before)} → ${kb(subset.length)}  ${path.relative(process.cwd(), outPath)}`,
			);
		}
	}

	await writeFile(CHARS_FILE, JSON.stringify({ hash, chars: characters }), 'utf8');
	if (!quiet) console.log('\n字体已更新。\n');
	return true;
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/build-fonts.mjs');
if (isDirectRun) {
	buildFonts().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
