import { copyFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportProteinViewer } from "./export-assets.mjs";
import { serveStatic } from "./serve.mjs";

// Export the viewer the way a host project would, then serve the bundled example page.
// --build-only stops after exporting; the docs site embeds demo-build/ as its live example.
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "demo-build");
await rm(out, { recursive: true, force: true });
await exportProteinViewer(out, dirname(createRequire(import.meta.url).resolve("molstar/package.json")));
await copyFile(join(here, "test/fixtures/1UBQ.pdb"), join(out, "1UBQ.pdb"));
if (process.argv.includes("--build-only")) {
	console.log(`已导出到 ${out}`);
	process.exit(0);
}

const port = Number(process.env.PORT ?? 5174);
const server = serveStatic(out);
server.on("error", error => {
	console.error(error.code === "EADDRINUSE" ? `端口 ${port} 被占用，换一个：PORT=5175 npm run demo` : error.message);
	process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
	console.log(`打开 http://127.0.0.1:${port}/protein-viewer-example.html?structure=1UBQ.pdb`);
	console.log("Ctrl+C 结束");
});
