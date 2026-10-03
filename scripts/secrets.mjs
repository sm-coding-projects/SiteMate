#!/usr/bin/env node
/**
 * Reads .dev.vars and either reports which secrets are set (`check`, name + prefix only) or uploads them
 * as production secrets with `wrangler secret bulk` over stdin (`push <origin>`). Values are never printed.
 * AUTHORIZED_PARTIES is replaced by the production origin; APP_ENV stays a plain var in wrangler.jsonc.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const REQUIRED = [
	"CLERK_SECRET_KEY",
	"CLERK_PUBLISHABLE_KEY",
	"R2_ACCOUNT_ID",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
];
const OPTIONAL = [
	"CLERK_JWT_KEY",
	"RESEND_API_KEY",
	"EMAIL_SANDBOX_TO",
	"ANTHROPIC_API_KEY",
	"OPENAI_COMPAT_API_KEY",
	"OPENAI_COMPAT_BASE_URL",
	"AI_GATEWAY_TOKEN",
	"SETTINGS_ENCRYPTION_KEY",
];

function readDevVars() {
	if (!existsSync(".dev.vars")) {
		console.error(".dev.vars not found — copy .dev.vars.example and fill it in.");
		process.exit(1);
	}
	const out = {};
	for (const raw of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq < 1) continue;
		let value = line.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1).replace(/\\n/g, "\n");
		}
		out[line.slice(0, eq).trim()] = value;
	}
	return out;
}

/** "sk_test_…(48)" — enough to tell test from live keys without revealing anything. */
const describe = (v) => {
	const m = /^([a-z]+_(?:test|live)_|re_|sk-ant-|pk_|sk_|-----BEGIN)/.exec(v);
	return `${m ? m[1] : v.includes("@") ? "<email>" : "<set>"}…(${v.length} chars)`;
};

const [cmd, origin] = process.argv.slice(2);
const vars = readDevVars();
let missing = 0;
for (const k of [...REQUIRED, ...OPTIONAL]) {
	const v = vars[k];
	const req = REQUIRED.includes(k);
	if (!v) missing += req ? 1 : 0;
	console.log(
		`${v ? "✓" : req ? "✗" : "·"} ${k.padEnd(24)} ${v ? describe(v) : req ? "MISSING (required)" : "not set (optional)"}`,
	);
}
if (cmd === "check") process.exit(missing ? 1 : 0);

if (cmd !== "push" || !origin) {
	console.error("Usage: node scripts/secrets.mjs check | push https://sitemate.<subdomain>.workers.dev");
	process.exit(1);
}
if (missing) {
	console.error("Fill in the required secrets first.");
	process.exit(1);
}
const secrets = { AUTHORIZED_PARTIES: new URL(origin).origin };
for (const k of [...REQUIRED, ...OPTIONAL]) if (vars[k]) secrets[k] = vars[k];
const res = spawnSync("pnpm", ["wrangler", "secret", "bulk"], {
	input: JSON.stringify(secrets),
	stdio: ["pipe", "inherit", "inherit"],
});
process.exit(res.status ?? 1);
