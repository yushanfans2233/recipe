import { stat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const VAULT_DIR = process.env.RECIPE_VAULT || 'C:/Users/32347/OneDrive/文档/obsidian/菜单/菜谱库';
export const IMAGE_DIR = process.env.RECIPE_IMAGES || 'C:/Users/32347/OneDrive/文档/obsidian/菜单/图片';
export const STATE_FILE = '.cache/sync-state.json';

/** 源目录指纹：用来判断线上内容是不是落后于 Obsidian */
export async function fingerprint(dirs = [VAULT_DIR, IMAGE_DIR]) {
	const hash = createHash('sha1');
	const files = [];

	const walk = async (current) => {
		const items = await readdir(current, { withFileTypes: true });
		for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
			const full = path.join(current, item.name);
			if (item.isDirectory()) await walk(full);
			else files.push(full);
		}
	};

	for (const dir of dirs) {
		const stats = await stat(dir).catch(() => null);
		if (!stats?.isDirectory()) continue;
		await walk(dir);
	}

	for (const file of files) {
		hash.update(path.relative(process.cwd(), file));
		hash.update(await readFile(file));
	}

	return { hash: hash.digest('hex').slice(0, 12), files: files.length };
}
