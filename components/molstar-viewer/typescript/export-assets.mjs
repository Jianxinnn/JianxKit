import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The host resolves its pinned Mol* installation; no network or bundler required. */
export async function exportProteinViewer(destination, molstarRoot) {
	const vendor = join(destination, "vendor/molstar");
	await mkdir(vendor, { recursive: true });
	for (const file of [
		"protein-viewer.html",
		"protein-viewer.js",
		"protein-viewer-client.js",
		"protein-workspace.js",
		"protein-viewer-example.html",
	]) {
		await copyFile(new URL(file, import.meta.url), join(destination, file));
	}
	for (const [source, target] of [
		["build/viewer/theme/dark.css", "molstar.css"],
		["LICENSE", "LICENSE"],
	]) {
		await copyFile(join(molstarRoot, source), join(vendor, target));
	}
	// The source map is not shipped, so a link to it only makes DevTools report a blocked request.
	const bundle = await readFile(join(molstarRoot, "build/viewer/molstar.js"), "utf8");
	await writeFile(join(vendor, "molstar.js"), bundle.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n"));
}
