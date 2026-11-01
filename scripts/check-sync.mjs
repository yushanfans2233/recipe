#!/usr/bin/env node
/**
 * 检查线上内容是否落后于 Obsidian 源目录。
 *
 * 用法：
 *   node scripts/check-sync.mjs          # 过期只提示（退出码 0）
 *   node scripts/check-sync.mjs --strict # 过期直接失败（提交前用）
 *
 * CI 里没有 .cache/sync-state.json，会直接跳过。
 */
import { readFile } from 'node:fs/promises';
import { STATE_FILE, VAULT_DIR, fingerprint } from './lib/vault-state.mjs';

const strict = process.argv.includes('--strict');

const saved = await readFile(STATE_FILE, 'utf8')
	.then((raw) => JSON.parse(raw))
	.catch(() => null);

if (!saved) {
	console.log('没有同步记录（可能是 CI 环境），跳过过期检查');
	process.exit(0);
}

const current = await fingerprint();

if (current.hash === saved.hash) {
	console.log(`内容是最新的（${saved.recipes} 道菜，${new Date(saved.syncedAt).toLocaleString('zh-CN')} 同步）`);
	process.exit(0);
}

const days = (Date.now() - new Date(saved.syncedAt).getTime()) / 86_400_000;
console.error(
	`\n⚠ Obsidian 源目录已改动，但站点内容还停留在 ${new Date(saved.syncedAt).toLocaleString('zh-CN')}（${days.toFixed(1)} 天前）。`,
);
console.error(`  源目录：${VAULT_DIR}`);
console.error('  跑一次 npm run sync 再提交。\n');

process.exit(strict ? 1 : 0);
