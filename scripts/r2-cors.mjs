#!/usr/bin/env node
/**
 * Sets the CORS rules on the R2 bucket so browsers can PUT/GET with presigned URLs.
 * Usage: node scripts/r2-cors.mjs https://sitemate.<subdomain>.workers.dev
 * (defaults to APP_URL from wrangler.jsonc). Always allows http://localhost:5173 for `pnpm dev`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const appUrl = process.argv[2] ?? wrangler.match(/"APP_URL":\s*"([^"]+)"/)?.[1];
const bucket = wrangler.match(/"bucket_name":\s*"([^"]+)"/)?.[1] ?? "sitemate-files";
if (!appUrl || appUrl.includes("example")) {
	console.error("Pass the deployed origin, e.g. node scripts/r2-cors.mjs https://sitemate.you.workers.dev");
	process.exit(1);
}
const origin = new URL(appUrl).origin;
const rules = {
	rules: [
		{
			allowed: {
				origins: ["http://localhost:5173", origin],
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
