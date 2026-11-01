import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };

/** Static server for the demo and browser test; it refuses paths outside `root`. */
export function serveStatic(root) {
	const base = resolve(root);
	return createServer(async (req, res) => {
		const path = resolve(base, "." + new URL(req.url, "http://localhost").pathname);
		if (!path.startsWith(base + "/")) { res.writeHead(403).end(); return; }
		try {
			const data = await readFile(path);
			res.setHeader("Content-Type", types[extname(path)] ?? "text/plain");
			res.end(data);
		} catch { res.writeHead(404).end(); }
	});
}
