#!/usr/bin/env node
/**
 * 检查字体子集是否覆盖了当前所有用字。
 *
 * 内容里出现新字却没重建字体时，浏览器会静默回退到系统字体。
 * 这个脚本让它在构建时就报错。修法：npm run fonts（或 npm run sync）。
 */
import { readFile } from 'node:fs/promises';
import { collectCharacters } from './build-fonts.mjs';

const CHARS_FILE = 'src/assets/fonts/subset-chars.json';

const raw = await readFile(CHARS_FILE, 'utf8').catch(() => null);
if (!raw) {
	console.error('\n✖ 找不到字体子集记录（src/assets/fonts/subset-chars.json），先跑 npm run fonts。\n');
	process.exit(1);
}

const state = JSON.parse(raw);
const known = new Set(state.chars ?? '');
const current = await collectCharacters();
const missing = [...new Set(current)].filter((char) => !known.has(char));

if (missing.length) {
	console.error(`\n✖ 有 ${missing.length} 个字符不在字体子集里，页面会回退成系统字体：`);
	console.error(`  ${missing.join(' ')}`);
	console.error('\n  修法：npm run fonts（npm run sync 也会自动重建）\n');
	process.exit(1);
}

console.log(`字体子集覆盖正常（${[...known].length} 字）`);
