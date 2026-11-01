import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { exportProteinViewer } from '../export-assets.mjs';

test('export writes the viewer, example page and vendored Mol* with its license', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'mykit-viewer-export-'));
	try {
		await exportProteinViewer(directory, dirname(createRequire(import.meta.url).resolve('molstar/package.json')));
		for (const file of ['protein-viewer.html', 'protein-viewer.js', 'protein-viewer-client.js', 'protein-workspace.js', 'protein-viewer-example.html', 'vendor/molstar/molstar.js', 'vendor/molstar/molstar.css']) {
			assert.ok((await readFile(join(directory, file))).length > 0, file);
		}
		assert.match(await readFile(join(directory, 'vendor/molstar/LICENSE'), 'utf8'), /MIT/);
		const bundle = await readFile(join(directory, 'vendor/molstar/molstar.js'), 'utf8');
		assert.equal(/sourceMappingURL/.test(bundle.slice(-400)), false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
