#!/usr/bin/env node
/**
 * Sets the CORS rules on the R2 bucket so browsers can PUT/GET with presigned URLs.
 * Usage: node scripts/r2-cors.mjs <app origin> [more origins…]
 * (defaults to APP_URL from wrangler.jsonc). Always allows http://localhost:5173 for `pnpm dev`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const appUrls =
	process.argv.length > 2 ? process.argv.slice(2) : [wrangler.match(/"APP_URL":\s*"([^"]+)"/)?.[1]];
const bucket = wrangler.match(/"bucket_name":\s*"([^"]+)"/)?.[1] ?? "sitemate-files";
if (appUrls.some((u) => !u || u.includes("example"))) {
	console.error("Pass the deployed origin, e.g. node scripts/r2-cors.mjs https://sitemate.you.workers.dev");
	process.exit(1);
}
const origins = appUrls.map((u) => new URL(u).origin);
const rules = {
	rules: [
		{
			allowed: {
				origins: ["http://localhost:5173", ...origins],
				methods: ["GET", "PUT", "HEAD"],
				headers: ["content-type"],
			},
			exposeHeaders: ["ETag"],
			maxAgeSeconds: 3600,
		},
	],
};
const file = join(mkdtempSync(join(tmpdir(), "sitemate-")), "cors.json");
writeFileSync(file, JSON.stringify(rules, null, 2));
console.log(`Setting CORS on ${bucket} for ${rules.rules[0].allowed.origins.join(", ")}`);
execFileSync("pnpm", ["wrangler", "r2", "bucket", "cors", "set", bucket, "--file", file, "--force"], {
	stdio: "inherit",
});
execFileSync("pnpm", ["wrangler", "r2", "bucket", "cors", "list", bucket], { stdio: "inherit" });
